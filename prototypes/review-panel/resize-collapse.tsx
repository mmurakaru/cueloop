/**
 * Throwaway prototype: a resizable, collapsible review rail. Mirrors herdr's
 * sidebar model - a toggle between expanded (resizable width, clamped) and
 * collapsed, where collapsed is either Compact (a narrow count+dots strip) or
 * Hidden (fully gone, reopen with the key). b cycles state, [ / ] resize by
 * keyboard, and the divider between plan and rail drag-resizes with the mouse.
 */

import React, { useState } from "react";
import { createCliRenderer } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { DARK } from "../../packages/client/src/theme";

const MIN_WIDTH = 24;
const MAX_WIDTH = 50;
const DEFAULT_WIDTH = 34;
const COMPACT_WIDTH = 6;

type Mode = "expanded" | "compact" | "hidden";

interface Note {
  kind: "comment" | "suggestion";
  author: string;
  quote: string;
  body: string;
}
const NOTES: Note[] = [
  { kind: "comment", author: "you", quote: "flow back to the planner", body: "sketch the flow diagram" },
  { kind: "suggestion", author: "alex", quote: "Oracle Always-Free VM", body: "check for a provisioning CLI" },
  { kind: "comment", author: "alex", quote: "default 30 days", body: "30 feels right" },
  { kind: "comment", author: "anon", quote: "accept-any-key auth", body: "does the fingerprint leak?" },
];

const AUTHOR_COLOR: Record<string, string> = { you: DARK.border, alex: DARK.blue, anon: DARK.textDim };
const kindColor = (kind: Note["kind"]) => (kind === "suggestion" ? DARK.green : DARK.accent);

const PLAN = [
  "# SSH sharing loop",
  "",
  "The planner shares a plan by copying one line; a collaborator",
  "pastes `ssh <id>@cueloop.dev` and the plan renders in their",
  "terminal - with the planner's annotations already on it.",
  "",
  "## Architecture",
  "- SSH gateway on an Oracle Always-Free VM",
  "- encrypted blobs in Cloudflare R2",
  "- DNS on Cloudflare, apex grey-cloud for :22",
];

function Plan(): React.ReactNode {
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
      {PLAN.map((line, index) => (
        <text key={index} fg={line.startsWith("#") ? DARK.text : DARK.textMuted}>{line}</text>
      ))}
    </box>
  );
}

/** The grabbable divider: a single vertical line (herdr-style), accent while dragging. */
function Divider({ dragging, onGrab, rows }: { dragging: boolean; onGrab: () => void; rows: number }): React.ReactNode {
  const line = Array.from({ length: Math.max(1, rows) }, () => "│").join("\n");
  return (
    <box style={{ width: 1 }} onMouseDown={onGrab}>
      <text fg={dragging ? DARK.accent : DARK.border}>{line}</text>
    </box>
  );
}

/** Expanded rail: name-in-border cards (the locked attribution style). */
function ExpandedRail({ width, onCollapse }: { width: number; onCollapse: () => void }): React.ReactNode {
  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
      <text>
        <span fg={DARK.accent}>Review</span>
        <span fg={DARK.textDim}>{`  ${NOTES.length} annotations  ${width} cols`}</span>
      </text>
      <box style={{ height: 1 }} />
      {NOTES.map((note, index) => (
        <box key={index} title={` ${note.author} `} style={{ flexDirection: "column", border: true, borderStyle: "rounded", borderColor: AUTHOR_COLOR[note.author] ?? DARK.border, marginBottom: 1, paddingLeft: 1, paddingRight: 1 }}>
          <text>
            <span fg={kindColor(note.kind)}>{note.kind.toUpperCase()}</span>
            <span fg={DARK.textDim}>{` "${note.quote}"`}</span>
          </text>
          <text fg={DARK.text}>{note.body}</text>
        </box>
      ))}
      {/* toggle: » on the left, points right (collapse the rail) */}
      <box style={{ flexGrow: 1 }} />
      <box style={{ flexDirection: "row", justifyContent: "flex-start" }} onMouseUp={onCollapse}>
        <text fg={DARK.textDim}>»</text>
      </box>
    </box>
  );
}

/** Compact rail: a narrow strip - count on top, a kind-colored dot per note. */
function CompactRail({ onExpand }: { onExpand: () => void }): React.ReactNode {
  return (
    <box style={{ width: COMPACT_WIDTH, flexDirection: "column", alignItems: "center" }}>
      <text fg={DARK.accent}>{String(NOTES.length)}</text>
      <box style={{ height: 1 }} />
      {NOTES.map((note, index) => (
        <text key={index} fg={kindColor(note.kind)}>●</text>
      ))}
      {/* toggle: « points left (pull open), left-bound to match the expanded » gap */}
      <box style={{ flexGrow: 1 }} />
      <box style={{ alignSelf: "flex-start", paddingLeft: 1 }} onMouseUp={onExpand}>
        <text fg={DARK.textDim}>«</text>
      </box>
    </box>
  );
}

function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [mode, setMode] = useState<Mode>("expanded");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);

  useKeyboard((key) => {
    if (key.name === "q") onExit();
    else if (key.name === "b") setMode((m) => (m === "expanded" ? "compact" : m === "compact" ? "hidden" : "expanded"));
    else if (key.name === "]" && mode === "expanded") setWidth((w) => Math.min(MAX_WIDTH, w + 2));
    else if (key.name === "[" && mode === "expanded") setWidth((w) => Math.max(MIN_WIDTH, w - 2));
  });

  const clampWidth = (raw: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));

  return (
    <box
      style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: DARK.bg }}
      onMouseDrag={(event: MouseEvent) => {
        if (dragging && mode === "expanded") setWidth(clampWidth(termWidth - event.x));
      }}
      onMouseUp={() => setDragging(false)}
    >
      <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
        <text>
          <span fg={DARK.accent}>review panel</span>
          <span fg={DARK.textDim}>{`  ·  ${mode}${mode === "expanded" ? ` (${width} cols, drag the divider or [ ])` : ""}`}</span>
        </text>
      </box>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        <Plan />
        {mode !== "hidden" ? (
          <Divider
            dragging={dragging}
            onGrab={() => {
              if (mode === "expanded") setDragging(true);
            }}
            rows={termHeight - 2}
          />
        ) : null}
        {mode === "expanded" ? (
          <ExpandedRail width={width} onCollapse={() => setMode("compact")} />
        ) : mode === "compact" ? (
          <CompactRail onExpand={() => setMode("expanded")} />
        ) : null}
      </box>
      <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
        <text fg={DARK.textDim}>b cycle expanded/compact/hidden · [ ] or drag the divider to resize · q quit</text>
      </box>
    </box>
  );
}

if (import.meta.main) {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(
    <App
      onExit={() => {
        renderer.destroy();
        queueMicrotask(() => process.exit(0));
      }}
    />,
  );
}
