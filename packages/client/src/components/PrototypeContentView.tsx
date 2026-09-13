/**
 * Prototype review surface: renders the HTML screenshot into a reserved cell
 * region via the kitty graphics protocol, and turns a click into a DOM-element
 * selection that opens the shared compose card - the same edit primitive plan
 * and diff use - so a note anchors to an element rather than a text span. The
 * image is painted directly (not through
 * OpenTUI's ImageRenderable, which does not display in every terminal): the
 * region's cells are never repainted, and the picture is re-placed after each
 * frame so it survives OpenTUI's own draws.
 */

import React, { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import * as v from "valibot";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Composer, DiscussionCard } from "./AnnotationCards";
import { annotationPaletteFor } from "../annotation-palette";
import {
  cssBoxToCell,
  imageCellToCss,
  prototypeRendererFactory,
  type PrototypeElement,
  type PrototypeRenderer,
  type PrototypeViewport,
} from "../prototype-browser";
import {
  deleteKittyImage,
  placeKittyImage,
  resolveTransmitMedium,
  transmitKittyImage,
  type CellRegion,
} from "../kitty-image";

export interface PrototypeContentViewProps {
  prototypePath: string;
  canComment: boolean;
  onCommentElement: (element: PrototypeElement, body: string) => void;
  /** Signals when the inline compose owns the keyboard, so the app suppresses
   *  its global keymap and the compose textarea receives the typed note. */
  onComposingChange?: (active: boolean) => void;
  /** True while an app overlay (menu, settings) covers the sheet; the image is
   *  removed so those overlays are not shown through the graphics layer. */
  hidden?: boolean;
  theme?: Theme;
}

type SheetStatus = "loading" | "ready" | "unsupported" | "error";

const OVERLAY_ROWS = 3;
/** Compose-card width, so the floating composer reads like the plan/diff one
 *  instead of shrinking to its content. */
const COMPOSE_COLS = 46;
const PROTOTYPE_IMAGE_ID = 811;
/** Page pixels scrolled per wheel notch. */
const SCROLL_STEP = 240;
// The capture viewport width in CSS pixels; its height matches the region's
// cell aspect so the rendered image fills the box instead of letterboxing. The
// aspect comes from the terminal's reported cell pixels, falling back to a
// typical monospace ratio when the terminal never reports one.
const CAPTURE_WIDTH = 1280;
const FALLBACK_CELL_HEIGHT_OVER_WIDTH = 2.18;

function cellHeightOverWidth(renderer: {
  resolution: { width: number; height: number } | null;
  terminalWidth: number;
  terminalHeight: number;
}): number {
  const resolution = renderer.resolution;

  if (!resolution || renderer.terminalWidth < 1 || renderer.terminalHeight < 1) {
    return FALLBACK_CELL_HEIGHT_OVER_WIDTH;
  }

  return resolution.height / renderer.terminalHeight / (resolution.width / renderer.terminalWidth);
}

function regionOf(box: BoxRenderable | null): CellRegion | null {
  if (!box || box.width < 1 || box.height < 1) return null;

  return { column: box.x, row: box.y, columns: box.width, rows: box.height };
}

type CaptureRenderer = {
  resolution: { width: number; height: number } | null;
  terminalWidth: number;
  terminalHeight: number;
};

/**
 * Capture at the region's own pixel size when the terminal reports its cell
 * pixels, so the terminal never downscales an oversized image (less Chromium
 * raster and fewer bytes). Without a resolution report, fall back to a fixed
 * width at 2x and derive the height from the cell aspect.
 */
function captureConfig(region: CellRegion, renderer: CaptureRenderer) {
  const resolution = renderer.resolution;

  if (resolution && renderer.terminalWidth >= 1 && renderer.terminalHeight >= 1) {
    const cellWidth = resolution.width / renderer.terminalWidth;
    const cellHeight = resolution.height / renderer.terminalHeight;

    return {
      viewport: {
        width: Math.max(1, Math.round(region.columns * cellWidth)),
        height: Math.max(1, Math.round(region.rows * cellHeight)),
      },
      deviceScaleFactor: 1,
    };
  }

  return {
    viewport: {
      width: CAPTURE_WIDTH,
      height: Math.round(
        (CAPTURE_WIDTH * region.rows * cellHeightOverWidth(renderer)) / region.columns,
      ),
    },
    deviceScaleFactor: 2,
  };
}

/**
 * The terminal's scheme, read from its reading-text color: a dark terminal
 * carries light text, a light terminal dark text. Passed to the renderer as
 * prefers-color-scheme so a theme-aware mockup emerges into the right surface.
 */
function terminalColorScheme(textColor: string): "dark" | "light" {
  const hex = textColor.replace("#", "");

  if (hex.length < 6) return "dark";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  return luminance > 0.5 ? "dark" : "light";
}

function PrototypeContentViewImpl({
  prototypePath,
  canComment,
  onCommentElement,
  onComposingChange,
  hidden = false,
  theme,
}: PrototypeContentViewProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const palette = annotationPaletteFor(tokens);
  const renderer = useRenderer();
  const regionRef = useRef<BoxRenderable | null>(null);
  const browserRef = useRef<PrototypeRenderer | null>(null);
  const launchedRef = useRef(false);
  const viewportRef = useRef<PrototypeViewport>({ width: CAPTURE_WIDTH, height: 800 });
  const pngRef = useRef<Uint8Array | null>(null);
  const transmittedRef = useRef<Uint8Array | null>(null);
  const paintRef = useRef<() => void>(() => undefined);
  const launchRef = useRef<() => void>(() => undefined);
  const hiddenRef = useRef(hidden);

  useEffect(() => {
    hiddenRef.current = hidden;
  });

  const [status, setStatus] = useState<SheetStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selected, setSelected] = useState<PrototypeElement | null>(null);
  const [overlayCell, setOverlayCell] = useState<{
    left: number;
    top: number;
    regionColumns: number;
  } | null>(null);
  const [composing, setComposing] = useState(false);

  const setPng = (png: Uint8Array): void => {
    pngRef.current = png;
    transmittedRef.current = null;
    paintRef.current();
  };

  // Every frame: start the browser once layout is known, then keep the picture
  // asserted over its cells. The kitty emission (transmit once, cheap re-place
  // after) is skipped when the renderer has no raw writeOut channel (the test
  // harness), but the launch trigger still runs.
  useEffect(() => {
    if (!renderer) return;
    const rendererOutput = v.safeParse(v.object({ writeOut: v.function() }), renderer);
    const rawWrite = rendererOutput.success ? rendererOutput.output.writeOut : null;
    const write = rawWrite ? (chunk: string) => rawWrite.call(renderer, chunk) : null;
    const medium = resolveTransmitMedium();
    const paint = (): void => {
      if (!write) return;
      // an app overlay is covering the sheet: pull the image so it does not show
      // through the overlay's cells, and re-transmit once the overlay closes
      if (hiddenRef.current) {
        if (transmittedRef.current !== null) {
          deleteKittyImage(write, PROTOTYPE_IMAGE_ID);
          transmittedRef.current = null;
        }

        return;
      }
      const region = regionOf(regionRef.current);
      const png = pngRef.current;

      if (!region || !png) return;
      if (transmittedRef.current !== png) {
        transmitKittyImage(write, png, region, PROTOTYPE_IMAGE_ID, medium);
        transmittedRef.current = png;
      } else {
        placeKittyImage(write, region, PROTOTYPE_IMAGE_ID);
      }
    };

    paintRef.current = paint;
    const onFrame = (): void => {
      launchRef.current();
      paint();
    };

    renderer.on("frame", onFrame);

    return () => {
      renderer.off("frame", onFrame);
      if (write) deleteKittyImage(write, PROTOTYPE_IMAGE_ID);
    };
  }, [renderer]);

  useEffect(() => {
    onComposingChange?.(composing);
  }, [composing, onComposingChange]);

  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      void browserRef.current?.close();
    };
  }, []);

  const launch = (): void => {
    const region = regionOf(regionRef.current);
    const caps = renderer?.capabilities;

    if (launchedRef.current || !region) return;
    if (caps && caps.kitty_graphics === false) {
      setStatus("unsupported");

      return;
    }
    launchedRef.current = true;
    const capture = captureConfig(region, renderer!);

    viewportRef.current = capture.viewport;
    void (async () => {
      try {
        const browser = await prototypeRendererFactory()({
          filePath: prototypePath,
          viewport: capture.viewport,
          deviceScaleFactor: capture.deviceScaleFactor,
          colorScheme: terminalColorScheme(tokens.text),
        });

        // the sheet may have unmounted while Chromium was launching; close the
        // late arrival instead of leaking the process
        if (unmountedRef.current) {
          void browser.close();

          return;
        }
        browserRef.current = browser;
        setPng(await browser.screenshot());
        setStatus("ready");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    })();
  };

  useEffect(() => {
    launchRef.current = launch;
  });

  const refresh = async (): Promise<void> => {
    const browser = browserRef.current;

    if (browser) setPng(await browser.screenshot());
  };

  const clearSelection = (): void => {
    setSelected(null);
    setOverlayCell(null);
    setComposing(false);
  };

  // While the compose textarea owns the keyboard, the global keymap is
  // suppressed, so escape-to-cancel is handled here - matching the plan
  // composer, where escape closes the overlay.
  useKeyboard((key) => {
    if (composing && key.name === "escape") clearSelection();
  });

  const onRegionMouseDown = (event: { x: number; y: number }): void => {
    const browser = browserRef.current;
    const region = regionOf(regionRef.current);

    if (status !== "ready" || !browser || !region) return;
    const geometry = {
      x: region.column,
      y: region.row,
      width: region.columns,
      height: region.rows,
    };
    const cssPoint = imageCellToCss(event, geometry, viewportRef.current);

    if (!cssPoint) return;
    void (async () => {
      const element = await browser.elementAt(cssPoint.x, cssPoint.y);

      if (!element) return;
      const cell = cssBoxToCell(element.box, geometry, viewportRef.current);
      const topRaw = cell.row - geometry.y;

      setSelected(element);
      setOverlayCell({
        left: Math.max(0, cell.column - geometry.x),
        top: Math.max(0, topRaw < OVERLAY_ROWS ? topRaw + 1 : topRaw - OVERLAY_ROWS),
        regionColumns: geometry.width,
      });
      // selecting an element opens the compose card directly, the same edit
      // primitive plan and diff use - there is no intermediate marker toolbar
      if (canComment) {
        onComposingChange?.(true);
        setComposing(true);
      } else {
        setComposing(false);
      }
    })().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus("error");
    });
  };

  const onRegionScroll = (event: { scroll?: { direction: string } }): void => {
    const browser = browserRef.current;

    if (status !== "ready" || !browser) return;
    const delta = event.scroll?.direction === "up" ? -SCROLL_STEP : SCROLL_STEP;

    // a selection would drift once the page scrolls under it, so drop it
    clearSelection();
    void browser
      .scrollBy(delta)
      .then(() => refresh())
      .catch(() => undefined);
  };

  const commit = (body: string): void => {
    if (!canComment) return;
    if (selected && body.trim()) onCommentElement(selected, body.trim());
    clearSelection();
  };

  // the overlay carries an opaque fill so the compose card reads as a solid
  // card over the image, matching the plan surface
  const overlayStyle = {
    position: "absolute" as const,
    left: overlayCell?.left ?? 0,
    top: Math.max(0, overlayCell?.top ?? 0),
    flexDirection: "column" as const,
    backgroundColor: tokens.elevated,
  };
  // keep the composer inside the region: never wider than the region, and
  // clamped so it cannot run off either edge on a narrow preview
  const regionColumns = overlayCell?.regionColumns ?? 0;
  const composeWidth = regionColumns > 0 ? Math.min(COMPOSE_COLS, regionColumns) : COMPOSE_COLS;
  const composeStyle = {
    ...overlayStyle,
    left: Math.max(0, Math.min(overlayStyle.left, regionColumns - composeWidth)),
    width: composeWidth,
  };

  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: "column",
      }}
    >
      <box
        ref={(instance: BoxRenderable | null) => {
          regionRef.current = instance;
        }}
        style={{ flexGrow: 1 }}
        onSizeChange={launch}
        onMouseDown={onRegionMouseDown}
        onMouseScroll={onRegionScroll}
      />
      {status !== "ready" ? (
        <box style={{ position: "absolute", left: 2, top: 1 }}>
          <text fg={tokens.textDim}>{statusLine(status, errorMessage)}</text>
        </box>
      ) : null}
      {selected && composing ? (
        <box style={composeStyle}>
          <DiscussionCard
            tokens={tokens}
            segments={[
              {
                color: palette.cardEdge,
                node: (
                  <Composer
                    seed=""
                    glyph="●"
                    tokens={tokens}
                    onSave={commit}
                    onReady={() => undefined}
                    onInput={() => undefined}
                  />
                ),
              },
            ]}
          />
        </box>
      ) : null}
    </box>
  );
}

/**
 * Memoized so an unrelated App re-render (status ticks, a rail-width drag) does
 * not re-render the view; the parent passes a stable onCommentElement so the
 * shallow prop compare holds.
 */
export const PrototypeContentView = React.memo(PrototypeContentViewImpl);

function statusLine(status: SheetStatus, errorMessage: string): string {
  if (status === "loading") return "rendering prototype…";
  if (status === "unsupported")
    return "prototype preview needs a graphics terminal (kitty or ghostty)";

  return `prototype preview failed: ${errorMessage}`;
}
