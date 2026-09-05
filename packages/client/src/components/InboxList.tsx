/**
 * The pending-review inbox: a Projects and Threads tree. Selection stays with
 * the keyboard grammar - the cursor indexes the flat thread order and this
 * component only renders the snapshot. The selected thread carries a [delete]
 * word-button (click, or `d` in the grammar). App supplies the surrounding
 * header and MenuBar chrome; this is the flex-growing body.
 */

import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Button } from "./primitives/Button";
import { NERD } from "./primitives/icons";
import type { InboxRow } from "./session-tree";

export interface InboxListProps {
  rows: InboxRow[];
  cursor: number;
  /** Ask to delete a thread (the selected row's [delete] button). */
  onRequestDelete?: (id: string, title: string) => void;
  theme?: Theme;
}

export function InboxList({
  rows,
  cursor,
  onRequestDelete,
  theme,
}: InboxListProps): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {rows.length === 0 ? (
        <text fg={tokens.textDim}>nothing waiting for review</text>
      ) : (
        rows.map((row) => {
          if (row.kind === "section") {
            return (
              <text key={row.id} fg={tokens.textDim}>
                {row.label}
              </text>
            );
          }

          if (row.kind === "project") {
            return (
              <text key={row.id}>
                <span fg={tokens.blue}>{` ${NERD.folderOpen} `}</span>
                <span fg={tokens.textMuted}>{row.label}</span>
              </text>
            );
          }

          const selected = row.selectionIndex === cursor;
          const title = row.session.artifact.meta.title ?? row.session.id;

          return (
            <box
              key={row.id}
              style={{
                flexDirection: "row",
                backgroundColor: selected ? tokens.elevated : undefined,
              }}
            >
              <text fg={selected ? tokens.accent : tokens.textMuted}>
                {"   "}
                {title}
              </text>
              <box style={{ flexGrow: 1 }} />
              {selected && onRequestDelete ? (
                <Button onPress={() => onRequestDelete(row.session.id, title)} theme={theme}>
                  {" [delete] "}
                </Button>
              ) : null}
            </box>
          );
        })
      )}
    </box>
  );
}
