/**
 * The pending-review inbox: a cursor-driven session list. Selection stays
 * with the keyboard grammar; the list only renders the snapshot.
 */

import React from "react";
import type { ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { StatusBar } from "./primitives/StatusBar";

export interface InboxListProps {
  inbox: ReviewSession[];
  cursor: number;
  theme?: Theme;
}

export function InboxList({ inbox, cursor, theme }: InboxListProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: tokens.bg, padding: 1 }}>
      <text fg={tokens.accent}>cueloop · inbox ({inbox.length} pending)</text>
      <text> </text>
      {inbox.length === 0 ? (
        <text fg={tokens.textDim}>nothing waiting for review</text>
      ) : (
        inbox.map((session, index) => (
          <text
            key={session.id}
            fg={index === cursor ? tokens.text : tokens.textMuted}
            bg={index === cursor ? tokens.cursorBg : undefined}
          >
            {index === cursor ? "▸ " : "  "}
            {session.artifact.meta.title ?? session.id} · {session.workspace.branch} · {session.artifact.type}
          </text>
        ))
      )}
      <box style={{ flexGrow: 1 }} />
      <StatusBar theme={theme}>j/k move · ⏎ open · q quit</StatusBar>
    </box>
  );
}
