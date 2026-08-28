/**
 * The Submit button expanded into a bordered confirm card at the rail bottom:
 * the verdict selector (arrow keys or click), the optional summary, and plain
 * word-buttons - key hints live in the status line only. The bordered height
 * derives from the content rows through Card, so layout and render never drift.
 */

import React from "react";
import type { VerdictKind } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Card } from "./primitives/Card";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";

export const VERDICTS: VerdictKind[] = ["comment", "approve", "request_changes"];

/** Selector words in the confirm card - one word per verdict. */
export const VERDICT_LABEL: Record<VerdictKind, string> = {
  comment: "Comment",
  approve: "Approve",
  request_changes: "Changes",
};

export interface ConfirmCardProps {
  verdict: VerdictKind;
  summary: string;
  /**
   * The guided walk's honest coverage line for diff sessions, e.g.
   * "2/3 files viewed". Undefined = no walk data, the row does not render.
   */
  viewedSummary?: string;
  onInput: (summary: string) => void;
  onSelectVerdict: (verdict: VerdictKind) => void;
  onSubmit: () => void;
  onCancel: () => void;
  theme?: Theme;
}

/** 1-row verdict selector, spacer, summary input, spacer, buttons. */
const CONFIRM_CONTENT_ROWS = 5;

export function verdictColor(verdict: VerdictKind, tokens: Theme): string {
  return verdict === "approve"
    ? tokens.green
    : verdict === "request_changes"
      ? tokens.red
      : tokens.blue;
}

/**
 * The verdict selector: one row of pressable words, matching the reading
 * direction of a choice between three peers. Selection stays controlled by
 * the grammar (←/→ cycle the verdict); a click selects directly. The
 * selected verdict wears brackets and its color.
 */
function VerdictSelector({
  verdict,
  onSelectVerdict,
  theme,
}: {
  verdict: VerdictKind;
  onSelectVerdict: (verdict: VerdictKind) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      {VERDICTS.map((candidate) => (
        <box
          key={candidate}
          style={{ paddingRight: 1 }}
          onMouseUp={() => onSelectVerdict(candidate)}
        >
          <text fg={candidate === verdict ? verdictColor(candidate, tokens) : tokens.textDim}>
            {candidate === verdict
              ? `[${VERDICT_LABEL[candidate]}]`
              : ` ${VERDICT_LABEL[candidate]} `}
          </text>
        </box>
      ))}
    </box>
  );
}

export function ConfirmCard({
  verdict,
  summary,
  viewedSummary,
  onInput,
  onSelectVerdict,
  onSubmit,
  onCancel,
  theme,
}: ConfirmCardProps): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <Card
      title=" submit review "
      contentRows={CONFIRM_CONTENT_ROWS + (viewedSummary !== undefined ? 2 : 0)}
      borderColor={tokens.text}
      backgroundColor="transparent"
      marginRight={1}
      theme={theme}
    >
      {viewedSummary !== undefined ? <text fg={tokens.textDim}>{viewedSummary}</text> : null}
      {viewedSummary !== undefined ? <box style={{ height: 1 }} /> : null}
      <VerdictSelector verdict={verdict} onSelectVerdict={onSelectVerdict} theme={theme} />
      <box style={{ height: 1 }} />
      <input
        focused
        value={summary}
        onInput={onInput}
        placeholder="summary for the agent (optional)"
      />
      <box style={{ height: 1 }} />
      <Toolbar>
        <Button variant="solid" marginRight={2} onPress={onSubmit} theme={theme}>
          {" Submit "}
        </Button>
        <Button onPress={onCancel} theme={theme}>
          {" Cancel "}
        </Button>
      </Toolbar>
    </Card>
  );
}
