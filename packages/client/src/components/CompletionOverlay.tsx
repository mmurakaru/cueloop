/**
 * Post-submit hand-back overlay: the agent is unblocked, the reviewer either
 * closes now, opts into auto-close, or dismisses back to the resolved view.
 * The latest status line (e.g. the vault-export path) stays visible here.
 */

import React from "react";
import type { VerdictKind } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";

export interface CompletionOverlayProps {
  verdict: VerdictKind;
  completion: { phase: "prompt" } | { phase: "counting"; remaining: number };
  /** Latest status line (e.g. the vault-export path) stays visible here. */
  status: string;
  /** Where focus goes on close (the agent's pane), when known. */
  returnsTo?: string;
  theme?: Theme;
}

export function CompletionOverlay({ verdict, completion, status, returnsTo, theme }: CompletionOverlayProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const approved = verdict === "approve";
  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: tokens.bg,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <text fg={approved ? tokens.green : tokens.accent}>{approved ? "✓ review approved" : "✎ feedback sent"}</text>
      <text> </text>
      <text fg={tokens.text}>The agent has your {approved ? "approval" : "feedback"} and is unblocked.</text>
      {status ? <text fg={tokens.textDim}>{status}</text> : null}
      <text> </text>
      {completion.phase === "counting" ? (
        <text fg={tokens.textDim}>
          closing in {completion.remaining}s{returnsTo ? ` - returning to ${returnsTo}` : ""} · ⏎ now · esc stay
        </text>
      ) : (
        <text fg={tokens.textDim}>⏎ close · a always close after submit (3s) · esc stay</text>
      )}
    </box>
  );
}
