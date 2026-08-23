/**
 * Prototype review surface: renders the HTML screenshot into a reserved cell
 * region via the kitty graphics protocol, and turns a click into a DOM-element
 * selection, so the shared marker actions bar and compose card annotate an
 * element rather than a text span. The image is painted directly (not through
 * OpenTUI's ImageRenderable, which does not display in every terminal): the
 * region's cells are never repainted, and the picture is re-placed after each
 * frame so it survives OpenTUI's own draws.
 */

import React, { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import type { Theme } from "../theme";
import { quickActionBody, type QuickAction } from "../config";
import { useComponentTheme } from "./theme-context";
import { FRAME_BORDER_STYLE } from "./primitives/frame";
import { MarkerPopover } from "./MarkerPopover";
import { AnnotationCard } from "./AnnotationCard";
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
  transmitKittyImage,
  type CellRegion,
} from "../kitty-image";

export interface PrototypeSheetProps {
  prototypePath: string;
  quickActions: QuickAction[];
  canComment: boolean;
  onCommentElement: (element: PrototypeElement, body: string) => void;
  /** Signals when the inline compose owns the keyboard, so the app suppresses
   *  its global keymap and the compose textarea receives the typed note. */
  onComposingChange?: (active: boolean) => void;
  theme?: Theme;
}

type SheetStatus = "loading" | "ready" | "unsupported" | "error";

const POPOVER_ROWS = 3;
const PROTOTYPE_IMAGE_ID = 811;
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

export function PrototypeSheet({
  prototypePath,
  quickActions,
  canComment,
  onCommentElement,
  onComposingChange,
  theme,
}: PrototypeSheetProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const renderer = useRenderer();
  const regionRef = useRef<BoxRenderable | null>(null);
  const browserRef = useRef<PrototypeRenderer | null>(null);
  const launchedRef = useRef(false);
  const viewportRef = useRef<PrototypeViewport>({ width: CAPTURE_WIDTH, height: 800 });
  const pngRef = useRef<Uint8Array | null>(null);
  const transmittedRef = useRef<Uint8Array | null>(null);
  const paintRef = useRef<() => void>(() => undefined);
  const launchRef = useRef<() => void>(() => undefined);

  const [status, setStatus] = useState<SheetStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selected, setSelected] = useState<PrototypeElement | null>(null);
  const [overlayCell, setOverlayCell] = useState<{ left: number; top: number } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draftText, setDraftText] = useState("");

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
    // writeOut is the renderer's raw output channel, ordered against its frame
    // bytes; it is private, so reach it through one narrow cast
    const rawWrite = (renderer as unknown as { writeOut?: (data: string) => void }).writeOut;
    const write =
      typeof rawWrite === "function" ? (chunk: string) => rawWrite.call(renderer, chunk) : null;
    const paint = (): void => {
      if (!write) return;
      const region = regionOf(regionRef.current);
      const png = pngRef.current;
      if (!region || !png) return;
      if (transmittedRef.current !== png) {
        transmitKittyImage(write, png, region, PROTOTYPE_IMAGE_ID);
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

  useEffect(() => {
    return () => {
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
    const viewport = {
      width: CAPTURE_WIDTH,
      height: Math.round(
        (CAPTURE_WIDTH * region.rows * cellHeightOverWidth(renderer!)) / region.columns,
      ),
    };
    viewportRef.current = viewport;
    void (async () => {
      try {
        const browser = await prototypeRendererFactory()({ filePath: prototypePath, viewport });
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
    setActionsOpen(false);
    setComposing(false);
    setDraftText("");
    void browserRef.current
      ?.highlight(null)
      .then(refresh)
      .catch(() => undefined);
  };

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
        top: Math.max(0, topRaw < POPOVER_ROWS ? topRaw + 1 : topRaw - POPOVER_ROWS),
      });
      setActionsOpen(false);
      setComposing(false);
      await browser.highlight(element.selector);
      await refresh();
    })().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus("error");
    });
  };

  const commit = (body: string): void => {
    if (!canComment) return;
    if (selected && body.trim()) onCommentElement(selected, body.trim());
    clearSelection();
  };

  const overlayStyle = {
    position: "absolute" as const,
    left: overlayCell?.left ?? 0,
    top: Math.max(0, overlayCell?.top ?? 0),
    flexDirection: "column" as const,
  };

  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: "column",
        border: true,
        borderStyle: FRAME_BORDER_STYLE,
        borderColor: tokens.text,
      }}
    >
      <box
        ref={(instance: BoxRenderable | null) => {
          regionRef.current = instance;
        }}
        style={{ flexGrow: 1 }}
        onSizeChange={launch}
        onMouseDown={onRegionMouseDown}
      />
      {status !== "ready" ? (
        <box style={{ position: "absolute", left: 2, top: 1 }}>
          <text fg={tokens.textDim}>{statusLine(status, errorMessage)}</text>
        </box>
      ) : null}
      {selected && !composing ? (
        <box style={overlayStyle}>
          <MarkerPopover
            view={actionsOpen ? "actions" : "toolbar"}
            actions={quickActions}
            actionIndex={0}
            canCut={false}
            onComment={() => {
              if (!canComment) return;
              onComposingChange?.(true);
              setComposing(true);
            }}
            onCut={() => undefined}
            onOpenActions={() => setActionsOpen(true)}
            onClose={clearSelection}
            onPickAction={(index) => commit(quickActionBody(quickActions[index]!))}
            onBack={() => setActionsOpen(false)}
            theme={theme}
          />
        </box>
      ) : null}
      {selected && composing ? (
        <box style={overlayStyle}>
          <AnnotationCard
            kind="comment"
            quote={selected.quote}
            draft={{
              text: draftText,
              onInput: setDraftText,
              onSave: () => commit(draftText),
              onSubmit: () => commit(draftText),
              onCancel: clearSelection,
            }}
            theme={theme}
          />
        </box>
      ) : null}
    </box>
  );
}

function statusLine(status: SheetStatus, errorMessage: string): string {
  if (status === "loading") return "rendering prototype…";
  if (status === "unsupported")
    return "prototype preview needs a graphics terminal (kitty or ghostty)";
  return `prototype preview failed: ${errorMessage}`;
}
