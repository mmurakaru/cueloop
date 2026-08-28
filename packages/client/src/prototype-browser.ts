/// <reference lib="dom" />
/**
 * Headless-Chromium backing for prototype review: render an HTML file to a PNG
 * and resolve a click coordinate to a DOM element. puppeteer-core is imported
 * lazily so plan/diff review and the test suite never load it.
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
  /** Scroll the page by a pixel delta; returns whether the scroll position moved. */
  scrollBy(deltaY: number): Promise<boolean>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  filePath: string;
  viewport: PrototypeViewport;
  /** Capture density; 1 when the viewport already matches the region's pixels. */
  deviceScaleFactor?: number;
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

export type PrototypeRendererFactory = (options: LaunchOptions) => Promise<PrototypeRenderer>;

let rendererFactory: PrototypeRendererFactory | null = null;

/** Override the renderer factory so tests can inject a browserless fake. */
export function setPrototypeRendererFactory(factory: PrototypeRendererFactory | null): void {
  rendererFactory = factory;
}

/** The active factory - the injected fake in tests, else real headless Chromium. */
export function prototypeRendererFactory(): PrototypeRendererFactory {
  return rendererFactory ?? launchPrototypeRenderer;
}

type PuppeteerBrowser = Awaited<ReturnType<typeof import("puppeteer-core").default.launch>>;

// One Chromium per process, kept warm and reused across prototype opens: the
// launch is the dominant load cost, so each open only spawns a fresh page.
let sharedBrowser: Promise<PuppeteerBrowser> | null = null;

async function warmBrowser(executablePath: string | undefined): Promise<PuppeteerBrowser> {
  // reuse the warm browser only while it is still connected; a crashed or
  // disconnected Chromium is dropped so the next open relaunches instead of
  // calling newPage on a dead process forever
  const cached = sharedBrowser ? await sharedBrowser.catch(() => null) : null;

  if (cached && cached.connected) return cached;
  const puppeteer = (await import("puppeteer-core")).default;
  const launched = puppeteer.launch({
    executablePath: executablePath ?? chromeExecutable(),
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  });

  sharedBrowser = launched;
  const browser = await launched.catch((error) => {
    if (sharedBrowser === launched) sharedBrowser = null;
    throw error;
  });

  browser.once("disconnected", () => {
    if (sharedBrowser === launched) sharedBrowser = null;
  });

  return browser;
}

export async function launchPrototypeRenderer(options: LaunchOptions): Promise<PrototypeRenderer> {
  const { pathToFileURL } = await import("node:url");
  const browser = await warmBrowser(options.executablePath);
  // close only the page on teardown, never the shared browser, so the next open
  // reuses the warm Chromium
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: options.deviceScaleFactor ?? 2,
    });
    // `load` waits for images and styles but skips networkidle0's fixed 500ms
    // idle window, which a static local file would otherwise always pay
    await page.goto(pathToFileURL(options.filePath).href, { waitUntil: "load" });
    // Render the mockup on the terminal's own surface rather than on an opaque
    // page: strip the root background so it never paints a square box, and the
    // capture (taken with alpha, below) lets the active terminal theme show
    // through around the mockup's own components - the prototype emerges into
    // whatever theme is running instead of sitting in a grey card.
    await page.evaluate(() => {
      for (const element of [document.documentElement, document.body]) {
        element?.style.setProperty("background", "transparent", "important");
      }
    });
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }

  return {
    viewport: options.viewport,
    async screenshot() {
      // omitBackground keeps the alpha from the stripped page background, so the
      // terminal composites the mockup over its own theme surface.
      const buffer = await page.screenshot({
        type: "png",
        encoding: "binary",
        omitBackground: true,
      });

      return new Uint8Array(buffer as Buffer);
    },
    async elementAt(cssX, cssY) {
      return (await page.evaluate(elementAtScript, cssX, cssY)) as PrototypeElement | null;
    },
    async scrollBy(deltaY) {
      return (await page.evaluate(scrollByScript, deltaY)) as boolean;
    },
    async close() {
      await page.close().catch(() => undefined);
    },
  };
}

/** Serialized into the page (self-contained for puppeteer): resolve the click to a component element. */
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
  const isNamed = (element: Element): boolean =>
    element.classList.length > 0 || SEMANTIC.has(element.tagName);
  // a card wraps several children: climb to the nearest named container holding
  // more than one child, else the nearest named ancestor, else the clicked leaf
  const componentRoot = (start: Element): Element => {
    let namedFallback: Element | null = null;
    let current: Element | null = start;

    while (current && current !== document.body) {
      if (isNamed(current)) {
        if (current.childElementCount > 1) return current;
        namedFallback = namedFallback ?? current;
      }
      current = current.parentElement;
    }

    return namedFallback ?? start;
  };
  const selectorFor = (start: Element): string => {
    const parts: string[] = [];
    let current: Element | null = start;

    while (current && current.nodeType === 1 && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift(part + "#" + CSS.escape(current.id));
        break;
      }
      const parent: Element | null = current.parentElement;

      if (parent) {
        const twins = [...parent.children].filter((child) => child.tagName === current!.tagName);

        if (twins.length > 1) part += ":nth-of-type(" + (twins.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = current.parentElement;
    }

    return parts.join(" > ");
  };
  const hit = document.elementFromPoint(x, y);

  if (!(hit instanceof Element)) return null;
  // A click on an interactive control anchors to that control - a button in a
  // grid is the target, not the grid. Everything else climbs to its component.
  const control = hit.closest(
    "button, a, [role='button'], input, select, textarea, label, summary",
  );
  const node = control ?? componentRoot(hit);
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

function scrollByScript(deltaY: number): boolean {
  const before = window.scrollY;

  window.scrollBy(0, deltaY);

  return window.scrollY !== before;
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
