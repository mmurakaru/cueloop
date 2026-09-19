/**
 * Post-submit hand-back overlay: the agent is unblocked, the reviewer either
 * closes now, opts into auto-close, or dismisses back to the resolved view.
 * The latest status line (e.g. the vault-export path) stays visible here.
 */

import React from "react";
import type { VerdictKind } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Toolbar } from "./primitives/Toolbar";
import { Button } from "./primitives/Button";

export interface CompletionOverlayProps {
  verdict: VerdictKind;
  completion: { phase: "prompt" } | { phase: "counting"; remaining: number };
  /** Latest status line (e.g. the vault-export path) stays visible here. */
  status: string;
  /** Where focus goes on close (the agent's pane), when known. */
  returnsTo?: string;
  onClose: () => void;
  onBackToPlan: () => void;
  onAlways: () => void;
  theme?: Theme;
}

export function CompletionOverlay({
  verdict,
  completion,
  status,
  returnsTo,
  onClose,
  onBackToPlan,
  onAlways,
  theme,
}: CompletionOverlayProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const approved = verdict === "approve";

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
