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
  /** Ids of pinned threads. */
  pinnedIds?: ReadonlySet<string>;
  onSelect: (sessionId: string) => void;
  /** Ask to delete a thread (the row menu's Delete, wired to the confirm dialog). */
  onRequestDelete?: (id: string, title: string) => void;
  /** Toggle a thread's pinned state (the row menu's Pin/Unpin). */
  onPin?: (id: string) => void;
  /** Rename a thread's title (the row menu's Rename). */
  onRename?: (id: string, title: string) => void;
  width?: number;
  theme?: Theme;
}

export function ThreadsSidebar({
  open,
  rows,
  cursor,
  activeId,
  pinnedIds,
  onSelect,
  onRequestDelete,
  onPin,
  onRename,
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
          pinnedIds={pinnedIds}
          width={width}
          onSelect={onSelect}
          onRequestDelete={onRequestDelete}
          onPin={onPin}
          onRename={onRename}
          theme={theme}
        />
      </scrollbox>
    </box>
  );
}
