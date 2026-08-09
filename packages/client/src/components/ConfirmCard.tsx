/**
 * The Submit button expanded into a bordered confirm card at the rail bottom:
 * honest counts, the verdict selector (arrow keys or click), the optional
 * summary, and plain word-buttons - key hints live in the status line only.
 * The bordered height derives from the content rows through Card, so layout
 * and render never drift.
 */

import React from "react";
import type { MouseEvent, SelectRenderable } from "@opentui/core";
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
  annotationCount: number;
  blockingCount: number;
  onInput: (summary: string) => void;
  onSelectVerdict: (verdict: VerdictKind) => void;
  onSubmit: () => void;
  onCancel: () => void;
  theme?: Theme;
}

/** Counts, spacer, 3-row verdict selector, spacer, summary input, spacer, buttons. */
const CONFIRM_CONTENT_ROWS = 9;

export function verdictColor(verdict: VerdictKind, tokens: Theme): string {
  return verdict === "approve" ? tokens.green : verdict === "request_changes" ? tokens.red : tokens.blue;
}

/**
 * The verdict selector over the native select renderable. Selection stays
 * controlled by the grammar (←/→ cycle the verdict); clicks map through the
 * option row geometry. The selected verdict wears brackets and its color.
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
  const selectedIndex = VERDICTS.indexOf(verdict);
  const selectorRef = React.useRef<SelectRenderable | null>(null);
  React.useEffect(() => {
    selectorRef.current?.setSelectedIndex(selectedIndex);
  }, [selectedIndex]);
  const onMouseUp = (event: MouseEvent): void => {
    const selector = selectorRef.current;
    if (!selector) return;
    const candidate = VERDICTS[event.y - selector.y];
    if (candidate) onSelectVerdict(candidate);
  };
  return (
    <select
      ref={selectorRef}
      options={VERDICTS.map((candidate) => ({
        name: candidate === verdict ? `[${VERDICT_LABEL[candidate]}]` : ` ${VERDICT_LABEL[candidate]} `,
        description: "",
        value: candidate,
      }))}
      selectedIndex={selectedIndex}
      showDescription={false}
      showSelectionIndicator={false}
      showScrollIndicator={false}
      textColor={tokens.textDim}
      selectedTextColor={verdictColor(verdict, tokens)}
      selectedBackgroundColor={tokens.elevated}
      backgroundColor={tokens.elevated}
      onMouseUp={onMouseUp}
      style={{ height: VERDICTS.length }}
    />
  );
}

export function ConfirmCard({
  verdict,
  summary,
  annotationCount,
  blockingCount,
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
      contentRows={CONFIRM_CONTENT_ROWS}
      borderColor={tokens.accent}
      marginRight={1}
      theme={theme}
    >
      <text fg={tokens.textDim}>{`${annotationCount} annotations · ${blockingCount} blocking`}</text>
      <box style={{ height: 1 }} />
      <VerdictSelector verdict={verdict} onSelectVerdict={onSelectVerdict} theme={theme} />
      <box style={{ height: 1 }} />
      <input focused value={summary} onInput={onInput} placeholder="summary for the agent (optional)" />
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
