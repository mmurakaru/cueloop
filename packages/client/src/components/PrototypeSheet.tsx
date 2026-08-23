/**
 * Prototype review surface: renders an HTML file as a kitty-graphics image in
 * the sheet frame and turns a click into a DOM-element selection, so the
 * marker actions bar and the compose card - the same components the plan
 * surface uses - annotate a chosen element (a design-system card, say) rather
 * than a text span.
 */

import React, { useEffect, useRef, useState } from "react";
import type { ImageRenderable } from "@opentui/core";
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
  launchPrototypeRenderer,
  type PrototypeElement,
  type PrototypeRenderer,
  type PrototypeViewport,
} from "../prototype-browser";

export interface PrototypeSheetProps {
  prototypePath: string;
  quickActions: QuickAction[];
  canComment: boolean;
  onCommentElement: (element: PrototypeElement, body: string) => void;
  theme?: Theme;
}

type SheetStatus = "loading" | "ready" | "unsupported" | "error";

const DEFAULT_CELL_ASPECT = 2;
const POPOVER_ROWS = 3;

export function PrototypeSheet({
  prototypePath,
  quickActions,
  canComment,
  onCommentElement,
  theme,
}: PrototypeSheetProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const renderer = useRenderer();
  const imageRef = useRef<ImageRenderable | null>(null);
  const browserRef = useRef<PrototypeRenderer | null>(null);
  const launchedRef = useRef(false);
  const viewportRef = useRef<PrototypeViewport>({ width: 1280, height: 800 });

  const [status, setStatus] = useState<SheetStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [selected, setSelected] = useState<PrototypeElement | null>(null);
  const [overlayCell, setOverlayCell] = useState<{ left: number; top: number } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draftText, setDraftText] = useState("");

  useEffect(() => {
    return () => {
      void browserRef.current?.close();
    };
  }, []);

  const viewportFor = (columns: number, rows: number): PrototypeViewport => {
    const resolution = renderer?.resolution ?? null;
    const cellWidth = resolution ? resolution.width / renderer!.terminalWidth : 1;
    const cellHeight = resolution
      ? resolution.height / renderer!.terminalHeight
      : DEFAULT_CELL_ASPECT;
    return {
      width: Math.max(320, Math.round(columns * cellWidth)),
      height: Math.max(240, Math.round(rows * cellHeight)),
    };
  };

  const launch = (): void => {
    const image = imageRef.current;
    if (launchedRef.current || !image || image.width < 1 || image.height < 1) return;
    if (renderer?.capabilities && renderer.capabilities.kitty_graphics === false) {
      setStatus("unsupported");
      return;
    }
    launchedRef.current = true;
    const viewport = viewportFor(image.width, image.height);
    viewportRef.current = viewport;
    void (async () => {
      try {
        const browser = await launchPrototypeRenderer({ filePath: prototypePath, viewport });
        browserRef.current = browser;
        setPng(await browser.screenshot());
        setStatus("ready");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    })();
  };

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
    void browserRef.current?.highlight(null).then(refresh);
  };

  const onImageMouseDown = (event: { x: number; y: number }): void => {
    const browser = browserRef.current;
    const image = imageRef.current;
    if (status !== "ready" || !browser || !image) return;
    const geometry = { x: image.x, y: image.y, width: image.width, height: image.height };
    const css = imageCellToCss(event, geometry, viewportRef.current);
    if (!css) return;
    void (async () => {
      const element = await browser.elementAt(css.x, css.y);
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
    })();
  };

  const commit = (body: string): void => {
    if (selected && body.trim()) onCommentElement(selected, body.trim());
    clearSelection();
  };

  const overlayLeft = overlayCell?.left ?? 0;
  const overlayTop = overlayCell?.top ?? 0;

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
      <image
        ref={(instance: ImageRenderable | null) => {
          imageRef.current = instance;
        }}
        {...(png ? { source: png } : {})}
        fit="fill"
        protocol="auto"
        style={{ flexGrow: 1 }}
        onSizeChange={launch}
        onMouseDown={onImageMouseDown}
      />
      {status !== "ready" ? (
        <box style={{ position: "absolute", left: 2, top: 1 }}>
          <text fg={tokens.textDim}>{statusLine(status, errorMessage)}</text>
        </box>
      ) : null}
      {selected && !composing ? (
        <box
          style={{
            position: "absolute",
            left: overlayLeft,
            top: Math.max(0, overlayTop),
            flexDirection: "column",
          }}
        >
          <MarkerPopover
            view={actionsOpen ? "actions" : "toolbar"}
            actions={quickActions}
            actionIndex={0}
            canCut={false}
            onComment={() => (canComment ? setComposing(true) : undefined)}
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
        <box
          style={{
            position: "absolute",
            left: overlayLeft,
            top: Math.max(0, overlayTop),
            flexDirection: "column",
          }}
        >
          <AnnotationCard
            kind="comment"
            quote={selected.quote}
            draft={{
              text: draftText,
              onInput: setDraftText,
              onSave: () => commit(draftText),
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
