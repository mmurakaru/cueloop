/**
 * Prototype: the submit confirmation, two variants (pass one as the argument).
 *
 *   modal - pressing n opens a centered confirm dialog over the dimmed plan:
 *           verdict selector, summary input, honest counts, Submit / Cancel
 *           word-buttons. The terminal-native confirm pattern.
 *   rail  - pressing n expands the Submit button into a confirm card at the
 *           bottom of the review rail: same content, no overlay, everything
 *           stays in the panel.
 *
 * Both replace the detached full-width bottom bar. Iconless.
 */

import React, { useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK as THEME } from "../../packages/client/src/theme";

const PLAN_LINES = [
  ["h1", "Implementation Plan: Guided Review Walk"],
  ["blank", ""],
  ["h2", "Context"],
  ["p", "Reviewing a multi-file change today means opening each file yourself"],
  ["p", "and remembering which ones you have already looked at. This plan adds"],
  ["p", "a guided walk that steps through every changed file in order."],
  ["blank", ""],
  ["h2", "Phase 1: Walk state"],
  ["p", "The session gains a viewed set keyed by file path. Viewed paths"],
  ["p", "persist with the session, so a resumed review keeps its progress."],
  ["blank", ""],
  ["h2", "Phase 2: The walk surface"],
  ["p", "The walk is a focused card wizard: one card per changed file with a"],
  ["p", "plain step count. Advancing marks the current file viewed."],
] as const;

const ANNOTATIONS = [
  { kind: "ISSUE", blocking: true, excerpt: "Durability of the atomic rename" },
  { kind: "QUESTION", blocking: false, excerpt: "Do we fsync the directory?" },
  { kind: "NIT", blocking: false, excerpt: "Name the recovery report type." },
  { kind: "COMMENT", blocking: false, excerpt: "Scope the retention window." },
  { kind: "QUESTION", blocking: false, excerpt: "One JSON file per session?" },
  { kind: "NIT", blocking: false, excerpt: "Prefer a numeric version field." },
  { kind: "COMMENT", blocking: false, excerpt: "Walk state belongs in schema." },
  { kind: "LOOKS GOOD", blocking: false, excerpt: "Read-only recovery is right." },
];

const VERDICTS = ["Comment", "Approve", "Changes"] as const;
type Verdict = (typeof VERDICTS)[number];

function verdictColor(verdict: Verdict): string {
  if (verdict === "Approve") return THEME.green;
  if (verdict === "Changes") return THEME.red;
  return THEME.accent;
}
function planLineColor(kind: string): string {
  if (kind === "h1") return THEME.accent;
  if (kind === "h2") return THEME.blue;
  return THEME.textMuted;
}

export function App({ variant, onExit }: { variant: "modal" | "rail"; onExit: () => void }): React.ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [verdictIndex, setVerdictIndex] = useState(2);
  const [summary, setSummary] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const verdict = VERDICTS[verdictIndex]!;
  const blockingCount = ANNOTATIONS.filter((annotation) => annotation.blocking).length;
  const width = process.stdout.columns ?? 120;
  const height = process.stdout.rows ?? 40;

  useKeyboard((key) => {
    if (submitted) {
      if (key.name === "q" || key.name === "return") onExit();
      return;
    }
    if (confirming) {
      if (key.name === "escape") setConfirming(false);
      else if (key.name === "return") setSubmitted(true);
      else if (key.name === "left") setVerdictIndex((index) => (index + VERDICTS.length - 1) % VERDICTS.length);
      else if (key.name === "right") setVerdictIndex((index) => (index + 1) % VERDICTS.length);
      return;
    }
    if (key.name === "q") onExit();
    else if (key.name === "n") setConfirming(true);
  });

  if (submitted) {
    return (
      <box style={{ flexDirection: "column", height: "100%", backgroundColor: THEME.bg, alignItems: "center", justifyContent: "center" }}>
        <text fg={verdictColor(verdict)}>{`review submitted · ${verdict.toLowerCase()}`}</text>
        <text fg={THEME.textDim}>{`${ANNOTATIONS.length} annotations delivered to the agent`}</text>
        <text fg={THEME.textDim}>press enter to close</text>
      </box>
    );
  }

  const confirmBody = (
    <>
      <text fg={THEME.textDim}>{`${ANNOTATIONS.length} annotations · ${blockingCount} blocking`}</text>
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row", height: 1 }}>
        {VERDICTS.map((candidate) => (
          <box key={candidate} style={{ paddingRight: 2 }} onMouseUp={() => setVerdictIndex(VERDICTS.indexOf(candidate))}>
            <text fg={candidate === verdict ? verdictColor(candidate) : THEME.textDim}>{candidate === verdict ? `[${candidate}]` : ` ${candidate} `}</text>
          </box>
        ))}
      </box>
      <box style={{ height: 1 }} />
      <input focused value={summary} onInput={setSummary} placeholder="summary for the agent (optional)" />
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row", height: 1 }}>
        <box style={{ backgroundColor: THEME.accent, marginRight: 2 }} onMouseUp={() => setSubmitted(true)}>
          <text fg={THEME.accentInk}>{" Submit "}</text>
        </box>
        <box style={{ backgroundColor: THEME.panel }} onMouseUp={() => setConfirming(false)}>
          <text fg={THEME.textMuted}>{" Cancel "}</text>
        </box>
      </box>
    </>
  );

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: THEME.bg }}>
      <box style={{ flexDirection: "row", height: 1, backgroundColor: THEME.panel }}>
        <text fg={THEME.accent}> cueloop </text>
        <text fg={THEME.textDim}>{`· submit confirm · variant: ${variant}`}</text>
      </box>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        {/* plan sheet */}
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
          {PLAN_LINES.map(([kind, text], lineIndex) =>
            kind === "blank" ? <box key={lineIndex} style={{ height: 1 }} /> : (
              <text key={lineIndex} fg={confirming && variant === "modal" ? THEME.textDim : planLineColor(kind)}>
                {kind === "h2" ? text.toUpperCase() : text}
              </text>
            ),
          )}
        </box>
        {/* rail */}
        <box style={{ flexDirection: "column", width: 38, backgroundColor: THEME.panel, paddingLeft: 1 }}>
          <text fg={THEME.accent}>{`Review (${ANNOTATIONS.length})`}</text>
          <box style={{ height: 1 }} />
          {/* the annotation stack scrolls when the confirm card takes its space */}
          <scrollbox style={{ flexGrow: 1 }} focused={false}>
            {ANNOTATIONS.map((annotation, annotationIndex) => (
              <box key={annotationIndex} style={{ flexDirection: "column", marginBottom: 1 }}>
                <text>
                  <span fg={annotation.kind === "ISSUE" ? THEME.red : THEME.textMuted}>{annotation.kind}</span>
                  {annotation.blocking ? <span fg={THEME.red}>{" · BLOCKING"}</span> : null}
                </text>
                <text fg={THEME.textMuted}>{annotation.excerpt}</text>
              </box>
            ))}
          </scrollbox>
          {confirming && variant === "rail" ? (
            <box style={{ height: 9, flexDirection: "column", border: true, borderStyle: "rounded", borderColor: THEME.accent, backgroundColor: THEME.elevated, paddingLeft: 1, marginRight: 1 }} title=" submit review ">
              {confirmBody}
            </box>
          ) : (
            <box style={{ height: 1, backgroundColor: THEME.accent, marginRight: 1 }} onMouseUp={() => setConfirming(true)}>
              <text fg={THEME.accentInk}>{`  Submit review (${ANNOTATIONS.length})  `}</text>
            </box>
          )}
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, backgroundColor: THEME.panel }}>
        <text fg={THEME.textDim}>{confirming ? " verdict ←/→ · ⏎ submit · esc cancel " : " n submit review · q quit "}</text>
      </box>

      {/* modal variant: centered confirm over the dimmed plan */}
      {confirming && variant === "modal" ? (
        <box style={{ position: "absolute", left: 0, top: 0, width, height, alignItems: "center", justifyContent: "center" }}>
          <box style={{ width: Math.min(56, width - 8), height: 9, border: true, borderStyle: "rounded", borderColor: THEME.accent, backgroundColor: THEME.panel, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }} title=" submit review ">
            {confirmBody}
          </box>
        </box>
      ) : null}
    </box>
  );
}

if (import.meta.main) {
  const variant = (process.argv[2] === "rail" ? "rail" : "modal") as "modal" | "rail";
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  createRoot(renderer).render(
    <App
      variant={variant}
      onExit={() => {
        renderer.destroy();
        process.exit(0);
      }}
    />,
  );
}
