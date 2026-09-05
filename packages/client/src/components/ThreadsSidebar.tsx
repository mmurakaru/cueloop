// The left Projects and Threads column: a collapsible, scrollable tree beside the
// thread. A click jumps to that thread; the open thread stays highlighted. Renders
// nothing when collapsed so the thread reclaims the width.

import React from "react";
import type { Theme } from "../theme";
import { InboxList } from "./InboxList";
import type { InboxRow } from "./session-tree";

export interface ThreadsSidebarProps {
  open: boolean;
  rows: InboxRow[];
  cursor: number;
  /** The open thread's id, highlighted in the list. */
  activeId?: string;
  onSelect: (sessionId: string) => void;
  width?: number;
  theme?: Theme;
}

export function ThreadsSidebar({
  open,
  rows,
  cursor,
  activeId,
  onSelect,
  width = 30,
  theme,
}: ThreadsSidebarProps): React.ReactNode {
  if (!open) return null;

  return (
    <box
      style={{
        width,
        flexDirection: "column",
        borderStyle: "single",
        border: ["right"],
        borderColor: theme?.border,
      }}
    >
      <scrollbox style={{ flexGrow: 1 }} focused={false}>
        <InboxList
          rows={rows}
          cursor={cursor}
          activeId={activeId}
          onSelect={onSelect}
          theme={theme}
        />
      </scrollbox>
    </box>
  );
}
