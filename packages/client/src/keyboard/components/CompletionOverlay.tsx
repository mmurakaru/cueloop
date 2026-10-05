/**
 * Post-submit hand-back overlay: the agent is unblocked, the reviewer either
 * closes now, opts into auto-close, or dismisses back to the resolved view.
 * The latest status line (e.g. the vault-export path) stays visible here.
 */

import React from "react";
import type { MessageOutcome } from "@cueloop/schema";
import type { Theme } from "../../appearance/theme";
import { useComponentTheme } from "../../appearance/components/theme-context";
import { Toolbar } from "../../ui/components/primitives/Toolbar";
import { Button } from "../../ui/components/primitives/Button";

export interface CompletionOverlayProps {
  message: MessageOutcome;
  completion: { phase: "prompt" } | { phase: "counting"; remaining: number };
  status: string;
  returnsTo?: string;
  onClose: () => void;
  onBackToPlan: () => void;
  onAlways: () => void;
  theme?: Theme;
}

export function CompletionOverlay({
  message,
  completion,
  status,
  returnsTo,
  onClose,
  onBackToPlan,
  onAlways,
  theme,
}: CompletionOverlayProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const approved = message === "approved";

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: tokens.background,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <text fg={approved ? tokens.green : tokens.accent}>
        {approved ? "review approved" : "feedback sent"}
      </text>
      <text> </text>
      <text fg={tokens.text}>
        The agent has your {approved ? "approval" : "feedback"} and is unblocked.
      </text>
      {returnsTo ? <text fg={tokens.textDim}>returning to {returnsTo} on close</text> : null}
      {status ? <text fg={tokens.textDim}>{status}</text> : null}
      {completion.phase === "counting" ? (
        <text fg={tokens.textDim}>closing in {completion.remaining}s</text>
      ) : null}
      <text> </text>
      <Toolbar>
        <Button variant="solid" marginRight={2} onPress={onClose} theme={theme}>
          {" close "}
        </Button>
        <Button marginRight={2} onPress={onBackToPlan} theme={theme}>
          {" back to plan "}
        </Button>
        <Button onPress={onAlways} theme={theme}>
          {" always "}
        </Button>
      </Toolbar>
    </box>
  );
}
