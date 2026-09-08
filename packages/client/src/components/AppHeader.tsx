// The one workbench header, split into column-aligned segments so it reads the
// same for every primitive: gear + left toggle over the Threads sidebar, the
// current thread's title (mirroring the sidebar selection) plus the owner's
// Edit/Share over the thread column, and a Changes label + right toggle over the
// right column. Collapsing a column keeps its toggle reachable at the edge.

import React from "react";
import type { Theme } from "../theme";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";

export interface AppHeaderProps {
  onOpenMenu: () => void;
  sidebarOpen: boolean;
  sidebarWidth?: number;
  onToggleSidebar: () => void;
  /** The center segment title; mirrors the selected sidebar thread, blank when none. */
  title: string;
  /** Owner actions rendered at the right edge of the thread segment (Edit/Share). */
  editShare?: React.ReactNode;
  changesOpen: boolean;
  changesWidth?: number;
  onToggleChanges: () => void;
  theme?: Theme;
}

export function AppHeader({
  onOpenMenu,
  sidebarOpen,
  sidebarWidth = 30,
  onToggleSidebar,
  title,
  editShare,
  changesOpen,
  changesWidth = 32,
  onToggleChanges,
  theme,
}: AppHeaderProps): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", height: 2, paddingTop: 1, backgroundColor: theme?.panel }}>
      {/* over the Threads sidebar: settings gear + the left toggle, product mark */}
      <box
        style={{
          flexDirection: "row",
          width: sidebarOpen ? sidebarWidth : undefined,
        }}
      >
        <box onMouseUp={onOpenMenu} style={{ paddingRight: 2 }}>
          <text fg={theme?.textMuted}>{NERD.settings}</text>
        </box>
        <IconButton
          glyph={sidebarOpen ? NERD.sidebarLeft : NERD.sidebarLeftOff}
          onPress={onToggleSidebar}
          marginRight={2}
          theme={theme}
        />
        <text fg={theme?.accent}>cueloop</text>
      </box>
      {/* over the thread column: the title, then the owner's Edit/Share at its right edge */}
      <box style={{ flexDirection: "row", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={theme?.textDim}>{title}</text>
        <box style={{ flexGrow: 1 }} />
        {editShare}
      </box>
      {/* over the right column: the Changes label when open, the right toggle always at the edge */}
      <box
        style={{
          flexDirection: "row",
          paddingRight: 1,
          width: changesOpen ? changesWidth : undefined,
        }}
      >
        {changesOpen ? <text fg={theme?.textDim}>Changes</text> : null}
        <box style={{ flexGrow: 1 }} />
        <IconButton
          glyph={changesOpen ? NERD.sidebarRight : NERD.sidebarRightOff}
          onPress={onToggleChanges}
          theme={theme}
        />
      </box>
    </box>
  );
}
