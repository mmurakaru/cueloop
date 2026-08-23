/// <reference lib="dom" />
/**
 * Headless-Chromium backing for prototype review: it renders an HTML file to a
 * PNG the TUI shows as a kitty-graphics image, and answers the two spatial
 * questions the review surface asks - which element is under a click, and where
 * a selector's element sits - so a terminal click resolves to a DOM element.
 * puppeteer-core is imported lazily so plan/diff review and the test suite
 * never load it.
 */

export interface PrototypeElement {
  /** Stable CSS selector - the annotation anchor's authority. */
  selector: string;
  /** Short human label for the rail card (element text, else the selector). */
  quote: string;
  /** Element rectangle in CSS pixels within the captured viewport. */
  box: ElementBox;
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrototypeViewport {
  width: number;
  height: number;
}

export interface PrototypeRenderer {
  readonly viewport: PrototypeViewport;
  screenshot(): Promise<Uint8Array>;
  elementAt(cssX: number, cssY: number): Promise<PrototypeElement | null>;
  boxFor(selector: string): Promise<ElementBox | null>;
  highlight(selector: string | null): Promise<void>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  filePath: string;
  viewport: PrototypeViewport;
  /** Absolute path to a Chrome/Chromium binary; falls back to the channel. */
  executablePath?: string;
}

/** Cell click -> CSS pixel inside the letterboxed image, or null when outside it. */
export function imageCellToCss(
  event: { x: number; y: number },
  image: { x: number; y: number; width: number; height: number },
  viewport: PrototypeViewport,
): { x: number; y: number } | null {
  const columnInImage = event.x - image.x;
  const rowInImage = event.y - image.y;
  if (
    columnInImage < 0 ||
    rowInImage < 0 ||
    columnInImage >= image.width ||
    rowInImage >= image.height
  ) {
    return null;
  }
  return {
    x: ((columnInImage + 0.5) / image.width) * viewport.width,
    y: ((rowInImage + 0.5) / image.height) * viewport.height,
  };
}

/** CSS pixel rect -> the image cell it maps to, for anchoring overlays. */
export function cssBoxToCell(
  box: ElementBox,
  image: { x: number; y: number; width: number; height: number },
  viewport: PrototypeViewport,
): { column: number; row: number; columns: number; rows: number } {
  const scaleColumn = image.width / viewport.width;
  const scaleRow = image.height / viewport.height;
  return {
    column: image.x + Math.floor(box.x * scaleColumn),
    row: image.y + Math.floor(box.y * scaleRow),
    columns: Math.max(1, Math.round(box.width * scaleColumn)),
    rows: Math.max(1, Math.round(box.height * scaleRow)),
  };
}

export async function launchPrototypeRenderer(options: LaunchOptions): Promise<PrototypeRenderer> {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: options.executablePath ?? chromeExecutable(),
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
    defaultViewport: {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: 2,
    },
  });
  const page = await browser.newPage();
  await page.goto(`file://${options.filePath}`, { waitUntil: "networkidle0" });

  return {
    viewport: options.viewport,
    async screenshot() {
      const buffer = await page.screenshot({ type: "png", encoding: "binary" });
      return new Uint8Array(buffer as Buffer);
    },
    async elementAt(cssX, cssY) {
      return (await page.evaluate(elementAtScript, cssX, cssY)) as PrototypeElement | null;
    },
    async boxFor(selector) {
      return (await page.evaluate(boxForScript, selector)) as ElementBox | null;
    },
    async highlight(selector) {
      await page.evaluate(highlightScript, selector);
    },
    async close() {
      await browser.close();
    },
  };
}

/**
 * Serialized into the page: the clicked leaf climbs to the nearest classed or
 * semantic ancestor, so a click inside a design-system card selects the card,
 * not its inner text. Self-contained (no page globals) for puppeteer transport.
 */
function elementAtScript(x: number, y: number): unknown {
  const SEMANTIC = new Set([
    "SECTION",
    "ARTICLE",
    "LI",
    "NAV",
    "HEADER",
    "FOOTER",
    "ASIDE",
    "FORM",
  ]);
  const componentRoot = (start: Element): Element => {
    let node: Element = start;
    let el: Element | null = start;
    while (el && el.parentElement && el !== document.body) {
      if (el.classList.length > 0 || SEMANTIC.has(el.tagName)) return el;
      node = el;
      el = el.parentElement;
    }
    return node;
  };
  const selectorFor = (start: Element): string => {
    const parts: string[] = [];
    let el: Element | null = start;
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      let part = el.tagName.toLowerCase();
      if (el.id) {
        parts.unshift(part + "#" + CSS.escape(el.id));
        break;
      }
      const parent: Element | null = el.parentElement;
      if (parent) {
        const twins = [...parent.children].filter((child) => child.tagName === el!.tagName);
        if (twins.length > 1) part += ":nth-of-type(" + (twins.indexOf(el) + 1) + ")";
      }
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(" > ");
  };
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof Element)) return null;
  const node = componentRoot(hit);
  const selector = selectorFor(node);
  if (!selector) return null;
  const text = (node.textContent || "").replace(/\s+/g, " ").trim();
  const tag = node.tagName.toLowerCase();
  const quote = text
    ? text.slice(0, 80)
    : node.id
      ? tag + "#" + node.id
      : node.classList.length
        ? tag + "." + node.classList[0]
        : tag;
  const rect = node.getBoundingClientRect();
  return { selector, quote, box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}

function boxForScript(selector: string): unknown {
  const node = document.querySelector(selector);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function highlightScript(selector: string | null): void {
  const ATTRIBUTE = "data-cueloop-selected";
  const STYLE_ID = "cueloop-highlight-style";
  document
    .querySelectorAll("[" + ATTRIBUTE + "]")
    .forEach((node) => node.removeAttribute(ATTRIBUTE));
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "[" + ATTRIBUTE + "]{outline:2px solid #f38ba8 !important;outline-offset:2px;}";
    document.head.appendChild(style);
  }
  if (selector) {
    const node = document.querySelector(selector);
    if (node) node.setAttribute(ATTRIBUTE, "");
  }
}

/** Standard Chrome install locations by platform; puppeteer-core ships no browser. */
function chromeExecutable(): string {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "/usr/bin/google-chrome";
}
