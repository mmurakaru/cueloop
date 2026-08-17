/**
 * The guided walk's focused card wizard: one card per changed file
 * floating over the dimmed diff, with a plain step count in the title - no
 * progress bar. Below the main card a separate gray-bordered block carries
 * the submitting agent's note for the file, when one exists. Past the last
 * file the end card offers the submit action directly with honest counts.
 * The keys live in the keymap's walk overlay; this component only renders.
 */

import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import type { WalkFile } from "../walk";
import { viewedCount } from "../walk";
import { Card } from "./primitives/Card";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";

export interface WalkWizardProps {
  files: WalkFile[];
  /** The wizard step; index === files.length renders the end card. */
  index: number;
  viewedPaths: ReadonlySet<string>;
  /** The agent's note for the current file; the gray block renders only when set. */
  note?: string;
  /** Terminal width bounds the card width. */
  terminalWidth: number;
  /** End-card submit: leaves the walk and opens the rail confirm. */
  onSubmitRequest: () => void;
  onBack: () => void;
  theme?: Theme;
}

/** The card never crowds the terminal edge nor stretches past reading width. */
function wizardWidth(terminalWidth: number): number {
  return Math.min(72, Math.max(24, terminalWidth - 8));
}

/** Note rows from a crude wrap estimate, capped so the block stays a block. */
function noteRows(note: string, innerWidth: number): number {
  return Math.min(3, Math.max(1, Math.ceil(note.length / Math.max(1, innerWidth))));
}

export function WalkWizard({
  files,
  index,
  viewedPaths,
  note,
  terminalWidth,
  onSubmitRequest,
  onBack,
  theme,
}: WalkWizardProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const width = wizardWidth(terminalWidth);
  const viewed = viewedCount(files, viewedPaths);
  const atEnd = index >= files.length;
  const currentFile = files[index];

  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <box style={{ width, flexDirection: "column" }}>
        {atEnd || !currentFile ? (
          <Card
            title=" walk complete "
            contentRows={3}
            borderColor={tokens.green}
            backgroundColor={tokens.elevated}
            theme={theme}
          >
            <text fg={tokens.text}>
              {viewed === files.length
                ? `every file viewed (${viewed}/${files.length})`
                : `${viewed} of ${files.length} files viewed`}
            </text>
            <box style={{ height: 1 }} />
            <Toolbar>
              <Button variant="solid" marginRight={2} onPress={onSubmitRequest} theme={theme}>
                {" Submit review "}
              </Button>
              <Button onPress={onBack} theme={theme}>
                {" [ back "}
              </Button>
            </Toolbar>
          </Card>
        ) : (
          <>
            <Card
              title={` file ${index + 1} of ${files.length} · ${viewed} viewed `}
              contentRows={3 + Math.max(1, currentFile.preview.length)}
              borderColor={tokens.accent}
              backgroundColor={tokens.elevated}
              theme={theme}
            >
              <text fg={tokens.text}>{currentFile.path}</text>
              <text>
                <span fg={tokens.green}>{`+${currentFile.added}`}</span>
                <span fg={tokens.textDim}>{" "}</span>
                <span fg={tokens.red}>{`-${currentFile.removed}`}</span>
                <span fg={tokens.textDim}>{viewedPaths.has(currentFile.path) ? " · viewed" : ""}</span>
              </text>
              <box style={{ height: 1 }} />
              {currentFile.preview.length === 0 ? (
                <text fg={tokens.textDim}>(no changed lines)</text>
              ) : (
                currentFile.preview.map((previewLine, previewIndex) => (
                  <text
                    key={previewIndex}
                    style={{ wrapMode: "none" }}
                    fg={previewLine.sign === "+" ? tokens.insertedForeground : tokens.deletedForeground}
                  >
                    {previewLine.sign + previewLine.text}
                  </text>
                ))
              )}
            </Card>
            {note !== undefined ? (
              <box style={{ marginTop: 1, flexDirection: "column" }}>
                <Card
                  title=" agent note "
                  contentRows={noteRows(note, width - 4)}
                  borderColor={tokens.border}
                  backgroundColor={tokens.elevated}
                  theme={theme}
                >
                  <text fg={tokens.textMuted}>{note}</text>
                </Card>
              </box>
            ) : null}
          </>
        )}
      </box>
    </box>
  );
}
