/**
 * The pending-review inbox: a cursor-driven session list. Selection stays with
 * the keyboard grammar; the list only renders the snapshot. The selected row
 * carries a [delete] word-button (click, or `d` in the grammar) that asks the
 * caller to confirm removal.
 */

import React from "react";
import type { ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { StatusBar } from "./primitives/StatusBar";
import { Button } from "./primitives/Button";

export interface InboxListProps {
  inbox: ReviewSession[];
  cursor: number;
  /** Ask to delete a plan (the selected row's [delete] button). */
  onRequestDelete?: (id: string, title: string) => void;
  theme?: Theme;
}

export function InboxList({ inbox, cursor, onRequestDelete, theme }: InboxListProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: tokens.bg, padding: 1 }}>
      <text fg={tokens.accent}>cueloop · inbox ({inbox.length} pending)</text>
      <text> </text>
      {inbox.length === 0 ? (
        <text fg={tokens.textDim}>nothing waiting for review</text>
      ) : (
        inbox.map((session, index) => {
          const selected = index === cursor;
          const title = session.artifact.meta.title ?? session.id;
          return (
            <box key={session.id} style={{ flexDirection: "row", backgroundColor: selected ? tokens.cursorBg : undefined }}>
              <text fg={selected ? tokens.text : tokens.textMuted}>
                {selected ? "▸ " : "  "}
                {title} · {session.workspace.branch} · {session.artifact.type}
              </text>
              <box style={{ flexGrow: 1 }} />
              {selected && onRequestDelete ? (
                <Button onPress={() => onRequestDelete(session.id, title)} theme={theme}>
                  {" [delete] "}
                </Button>
              ) : null}
            </box>
          );
        })
      )}
      <box style={{ flexGrow: 1 }} />
      <StatusBar theme={theme}>j/k move · ⏎ open · d delete · q quit</StatusBar>
    </box>
  );
}
