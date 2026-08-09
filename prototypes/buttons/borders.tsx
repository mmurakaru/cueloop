/**
 * Throwaway prototype for issue #116: do buttons get border radius, or stay
 * text-first with only the container framed? Each variant shows the same
 * action row (Comment / Approve / Request changes) inside a rounded card, so
 * the frame-vs-button weight is comparable. h/l to switch, q to quit.
 */

import React, { useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK } from "../../packages/client/src/theme";

const ACTIONS = [
  { label: "Comment", primary: false },
  { label: "Approve", primary: true },
  { label: "Request changes", primary: false },
];

/** A - text-first (today): bare word buttons, one accent-filled primary. */
function TextFirst(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row" }}>
      {ACTIONS.map((action, index) => (
        <box key={index} style={{ marginRight: 2, backgroundColor: action.primary ? DARK.accent : undefined, paddingLeft: action.primary ? 1 : 0, paddingRight: action.primary ? 1 : 0 }}>
          <text fg={action.primary ? DARK.accentInk : DARK.textDim}>{action.label}</text>
        </box>
      ))}
    </box>
  );
}

/** B - every action in its own rounded border box. */
function RoundedButtons(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row" }}>
      {ACTIONS.map((action, index) => (
        <box
          key={index}
          style={{ marginRight: 2, border: true, borderStyle: "rounded", borderColor: action.primary ? DARK.accent : DARK.border, paddingLeft: 1, paddingRight: 1 }}
        >
          <text fg={action.primary ? DARK.accent : DARK.textMuted}>{action.label}</text>
        </box>
      ))}
    </box>
  );
}

/** C - every action in a single (square) border box. */
function SquareButtons(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row" }}>
      {ACTIONS.map((action, index) => (
        <box
          key={index}
          style={{ marginRight: 2, border: true, borderStyle: "single", borderColor: action.primary ? DARK.accent : DARK.border, paddingLeft: 1, paddingRight: 1 }}
        >
          <text fg={action.primary ? DARK.accent : DARK.textMuted}>{action.label}</text>
        </box>
      ))}
    </box>
  );
}

/** D - hybrid: only the primary is bordered (rounded); the rest stay text-first. */
function HybridPrimary(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", alignItems: "center" }}>
      {ACTIONS.map((action, index) =>
        action.primary ? (
          <box key={index} style={{ marginRight: 2, border: true, borderStyle: "rounded", borderColor: DARK.accent, paddingLeft: 1, paddingRight: 1 }}>
            <text fg={DARK.accent}>{action.label}</text>
          </box>
        ) : (
          <box key={index} style={{ marginRight: 2 }}>
            <text fg={DARK.textDim}>{action.label}</text>
          </box>
        ),
      )}
    </box>
  );
}

const VARIANTS = [
  { name: "A · text-first (today)", render: TextFirst },
  { name: "B · rounded buttons", render: RoundedButtons },
  { name: "C · square buttons", render: SquareButtons },
  { name: "D · hybrid (primary bordered only)", render: HybridPrimary },
];

function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const [index, setIndex] = useState(0);
  useKeyboard((key) => {
    if (key.name === "q") onExit();
    else if (key.name === "l" || key.name === "right") setIndex((current) => (current + 1) % VARIANTS.length);
    else if (key.name === "h" || key.name === "left") setIndex((current) => (current - 1 + VARIANTS.length) % VARIANTS.length);
  });
  const variant = VARIANTS[index]!;
  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: DARK.bg }}>
      <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
        <text>
          <span fg={DARK.accent}>button borders</span>
          <span fg={DARK.textDim}>{`  ·  ${variant.name}  (${index + 1}/${VARIANTS.length})`}</span>
        </text>
      </box>
      <box style={{ flexGrow: 1, padding: 2, flexDirection: "column" }}>
        {/* the rounded container frame - the "soft frame, lean button" idea */}
        <box style={{ width: 54, flexDirection: "column", border: true, borderStyle: "rounded", borderColor: DARK.border, padding: 1 }} title=" submit review ">
          <text fg={DARK.textMuted}>How should this land?</text>
          <box style={{ height: 1 }} />
          {variant.render()}
        </box>
        <box style={{ height: 1 }} />
        <text fg={DARK.textDim}>the frame is always rounded; the row above is the button treatment</text>
      </box>
      <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
        <text fg={DARK.textDim}>h/l switch treatment · q quit</text>
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
