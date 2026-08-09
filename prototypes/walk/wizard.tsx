/**
 * Prototype: the guided walk as a focused card wizard.
 *
 * One card per changed file with a plain step count (file 2 of 5 · 3 viewed),
 * no progress bar. ] advances (marking the current file viewed), [ steps
 * back - the same prev/next keys diff navigation uses. The file list stays
 * visible and dimmed behind the card. At the end the card offers the submit
 * action directly. esc leaves the walk without losing progress. Iconless.
 */

import React, { useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK as THEME } from "../../packages/client/src/theme";

interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  preview: string[];
  /** The agent's own explanation of the change, in dead prose. */
  agentNote: string;
}

const CHANGED_FILES: ChangedFile[] = [
  {
    path: "packages/daemon/src/store.ts",
    added: 12,
    removed: 3,
    preview: ["+ const viewed = new Set<string>();", "+ record.viewedPaths = [...viewed];", "- // viewed tracking lives in the client only"],
    agentNote: "Persists the viewed set with the session record. Optional field, so existing records load unchanged.",
  },
  {
    path: "packages/client/src/walk.ts",
    added: 48,
    removed: 0,
    preview: ["+ export function nextUnviewed(files, viewed) {", "+   return files.find((file) => !viewed.has(file.path));", "+ }"],
    agentNote: "New module: pure helpers that pick the next unviewed file. No IO, unit tested.",
  },
  {
    path: "packages/client/src/App.tsx",
    added: 25,
    removed: 4,
    preview: ["+ case \"walkForward\":", "+   markViewed(currentFile); advance();", "- // no walk mode"],
    agentNote: "Wires the walk intents into the key reducer. The wizard card renders over the dimmed file list.",
  },
  {
    path: "packages/schema/src/types.ts",
    added: 3,
    removed: 0,
    preview: ["+ /** Paths the reviewer marked viewed during the walk. */", "+ viewedPaths?: string[];"],
    agentNote: "One optional field on the session shape. The wire schema mirrors it with the drift guard.",
  },
  {
    path: "test/session/walk.test.tsx",
    added: 61,
    removed: 0,
    preview: ["+ test(\"resumed review keeps its viewed set\", async () => {", "+   ..."],
    agentNote: "Covers resume: a half-walked review reopens at the first unviewed file with progress intact.",
  },
];

export function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const [walking, setWalking] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);

  const atEnd = stepIndex >= CHANGED_FILES.length;
  const currentFile = CHANGED_FILES[stepIndex];
  const width = process.stdout.columns ?? 120;
  const height = process.stdout.rows ?? 40;

  useKeyboard((key) => {
    if (done) {
      if (key.name === "q" || key.name === "return") onExit();
      return;
    }
    if (key.name === "q") onExit();
    else if (!walking && key.name === "w") setWalking(true);
    else if (!walking) return;
    else if (key.name === "escape") setWalking(false);
    else if (key.sequence === "]") {
      // Derive the viewed file from the live index, never the render closure,
      // so rapid advances mark every stepped-over file.
      setStepIndex((index) => {
        if (index >= CHANGED_FILES.length) return index;
        setViewed((existing) => new Set(existing).add(CHANGED_FILES[index]!.path));
        return index + 1;
      });
    } else if (key.sequence === "[") {
      setStepIndex((index) => Math.max(0, index - 1));
    } else if (atEnd && key.name === "return") setDone(true);
  });

  if (done) {
    return (
      <box style={{ flexDirection: "column", height: "100%", backgroundColor: THEME.bg, alignItems: "center", justifyContent: "center" }}>
        <text fg={THEME.green}>walk complete · review submitted</text>
        <text fg={THEME.textDim}>{`${viewed.size}/${CHANGED_FILES.length} files viewed`}</text>
        <text fg={THEME.textDim}>press enter to close</text>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: THEME.bg }}>
      <box style={{ flexDirection: "row", height: 1, backgroundColor: THEME.panel }}>
        <text fg={THEME.accent}> cueloop </text>
        <text fg={THEME.textDim}>{`· guided walk · ${viewed.size}/${CHANGED_FILES.length} viewed`}</text>
      </box>

      {/* file list, dimmed while the wizard card has focus */}
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
        <text fg={THEME.textDim}>CHANGED FILES</text>
        {CHANGED_FILES.map((file, fileIndex) => {
          const isCurrent = walking && fileIndex === stepIndex;
          const wasViewed = viewed.has(file.path);
          return (
            <text key={file.path} fg={isCurrent ? THEME.text : walking ? THEME.textDim : THEME.textMuted}>
              <span fg={wasViewed ? THEME.green : THEME.textDim}>{wasViewed ? " viewed  " : "         "}</span>
              <span>{file.path}</span>
              <span fg={THEME.green}>{`  +${file.added}`}</span>
              <span fg={THEME.red}>{` -${file.removed}`}</span>
            </text>
          );
        })}
        {!walking ? <text fg={THEME.textMuted}>{"\nw resumes the walk at the first unviewed file"}</text> : null}
      </box>

      <box style={{ flexDirection: "row", height: 1, backgroundColor: THEME.panel }}>
        <text fg={THEME.textDim}>{walking ? " ] next (marks viewed) · [ back · esc leave walk · q quit " : " w walk · q quit "}</text>
      </box>

      {/* the focused wizard card */}
      {walking ? (
        <box style={{ position: "absolute", left: 0, top: 0, width, height, alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <box
            style={{ width: Math.min(72, width - 8), border: true, borderStyle: "rounded", borderColor: atEnd ? THEME.green : THEME.accent, backgroundColor: THEME.panel, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
            title={atEnd ? " walk complete " : ` file ${stepIndex + 1} of ${CHANGED_FILES.length} · ${viewed.size} viewed `}
          >
            {atEnd ? (
              <>
                <text fg={THEME.text}>{`every file viewed (${viewed.size}/${CHANGED_FILES.length})`}</text>
                <box style={{ height: 1 }} />
                <box style={{ flexDirection: "row", height: 1 }}>
                  <box style={{ backgroundColor: THEME.green, marginRight: 2 }} onMouseUp={() => setDone(true)}>
                    <text fg={THEME.accentInk}>{" Submit review "}</text>
                  </box>
                  <box onMouseUp={() => setStepIndex((index) => Math.max(0, index - 1))}>
                    <text fg={THEME.textDim}>{" [ back "}</text>
                  </box>
                </box>
              </>
            ) : (
              <>
                <text fg={THEME.text}>{currentFile!.path}</text>
                <text fg={THEME.textDim}>
                  <span fg={THEME.green}>{`+${currentFile!.added}`}</span>
                  <span>{" "}</span>
                  <span fg={THEME.red}>{`-${currentFile!.removed}`}</span>
                  <span>{viewed.has(currentFile!.path) ? " · viewed" : ""}</span>
                </text>
                <box style={{ height: 1 }} />
                {currentFile!.preview.map((previewLine, previewIndex) => (
                  <text key={previewIndex} fg={previewLine.startsWith("+") ? THEME.insFg : previewLine.startsWith("-") ? THEME.delFg : THEME.textMuted}>
                    {previewLine}
                  </text>
                ))}

              </>
            )}
          </box>
          {!atEnd ? (
            <box
              style={{ width: Math.min(72, width - 8), height: 3, marginTop: 1, border: true, borderStyle: "rounded", borderColor: THEME.border, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
              title=" agent note "
            >
              <text fg={THEME.textMuted}>{currentFile!.agentNote}</text>
            </box>
          ) : null}
        </box>
      ) : null}
    </box>
  );
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  createRoot(renderer).render(
    <App
      onExit={() => {
        renderer.destroy();
        process.exit(0);
      }}
    />,
  );
}
