/**
 * The Submit button expanded into a bordered confirm card at the rail bottom:
 * the message selector (arrow keys or click), the optional summary, and plain
 * word-buttons - key hints live in the status line only. The bordered height
 * derives from the content rows through Card, so layout and render never drift.
 */

import React, { useContext } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { MESSAGE_OUTCOMES, type MessageOutcome } from "@cueloop/schema";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import { SlashSkillsContext } from "../skills";
import { activeSlashToken, mergeSlashItems, slashFilter, slashItemsFrom } from "../slash-palette";
import { useComponentTheme } from "./theme-context";
import { Card } from "./primitives/Card";
import { composeRowCount } from "./AnnotationCards";
import { SlashComposer } from "./SlashComposer";
import { DialogActions } from "./primitives/DialogActions";

const SUBMIT_CARD_MAX_WIDTH = 52;
const PALETTE_WINDOW = 5;

/** Selector words in the confirm card - one word per message. */
export const MESSAGE_OUTCOME_LABEL: Record<MessageOutcome, string> = {
  comment: "Comment",
  approved: "Approve",
  changes_requested: "Request changes",
};

export interface ConfirmCardProps {
  message: MessageOutcome;
  summary: string;
  /**
   * The guided walk's honest coverage line for diff sessions, e.g.
   * "2/3 files viewed". Undefined = no walk data, the row does not render.
   */
  viewedSummary?: string;
  onInput: (summary: string) => void;
  onSelectMessage: (message: MessageOutcome) => void;
  onSubmit: () => void;
  onCancel: () => void;
  quickActions: QuickAction[];
  theme?: Theme;
}

/** 1-row message selector, spacer, summary input, spacer, buttons. */
const CONFIRM_CONTENT_ROWS = 5;

export function outcomeColor(message: MessageOutcome, tokens: Theme): string {
  return message === "approved"
    ? tokens.green
    : message === "changes_requested"
      ? tokens.red
      : tokens.blue;
}

/**
 * The message selector: one row of pressable words, matching the reading
 * direction of a choice between two outcomes. Selection stays controlled by
 * the grammar (←/→ cycle the message); a click selects directly. The
 * selected message wears brackets and its color.
 */
function MessageSelector({
  message,
  onSelectMessage,
  theme,
}: {
  message: MessageOutcome;
  onSelectMessage: (message: MessageOutcome) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <box style={{ flexDirection: "row", height: 1, width: "100%", justifyContent: "center" }}>
      {MESSAGE_OUTCOMES.map((candidate) => (
        <box
          key={candidate}
          style={{ paddingRight: 1 }}
          onMouseUp={() => onSelectMessage(candidate)}
        >
          <text fg={candidate === message ? outcomeColor(candidate, tokens) : tokens.textDim}>
            {candidate === message
              ? `[${MESSAGE_OUTCOME_LABEL[candidate]}]`
              : MESSAGE_OUTCOME_LABEL[candidate]}
          </text>
        </box>
      ))}
    </box>
  );
}

export function ConfirmCard({
  message,
  summary,
  viewedSummary,
  onInput,
  onSelectMessage,
  onSubmit,
  onCancel,
  quickActions,
  theme,
}: ConfirmCardProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const skills = useContext(SlashSkillsContext);
  const { width: terminalWidth } = useTerminalDimensions();
  const cardWidth = Math.max(24, Math.min(terminalWidth - 2, SUBMIT_CARD_MAX_WIDTH));

  const composerRows = composeRowCount(summary, cardWidth - 4);
  const token = activeSlashToken(summary, summary.length);
  const paletteItems =
    token !== null
      ? slashFilter(mergeSlashItems(slashItemsFrom(quickActions), skills), token.slice(1))
      : [];
  const paletteRows =
    paletteItems.length > 0
      ? Math.min(PALETTE_WINDOW, paletteItems.length) +
        (paletteItems.length > PALETTE_WINDOW ? 1 : 0)
      : 0;
  const contentRows =
    CONFIRM_CONTENT_ROWS - 1 + composerRows + paletteRows + (viewedSummary !== undefined ? 2 : 0);

  return (
    <Card
      contentRows={contentRows}
      width={cardWidth}
      borderColor={tokens.accent}
      backgroundColor={tokens.elevated}
      theme={theme}
    >
      {viewedSummary !== undefined ? <text fg={tokens.textDim}>{viewedSummary}</text> : null}
      {viewedSummary !== undefined ? <box style={{ height: 1 }} /> : null}
      <MessageSelector message={message} onSelectMessage={onSelectMessage} theme={theme} />
      <box style={{ height: 1 }} />
      <SlashComposer
        seed={summary}
        glyph=""
        quickActions={quickActions}
        tokens={tokens}
        placeholder="summary for the agent (optional)"
        onSubmit={(text) => {
          onInput(text);
          onSubmit();
        }}
        onInput={onInput}
      />
      <box style={{ height: 1 }} />
      <DialogActions confirmLabel="send" onConfirm={onSubmit} onCancel={onCancel} theme={theme} />
    </Card>
  );
}
