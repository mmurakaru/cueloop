// The app shell's top row, shared by the thread view and the no-thread welcome so
// the two never drift: the settings gear, the left-sidebar toggle, a breadcrumb,
// and an optional right-aligned action slot (Edit/Share, the Changes toggle).

import React from "react";
import type { Theme } from "../theme";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";

/** The left panel toggle glyph: the mirrored sidebar icon, filled when the column is open. */
export function sidebarToggleGlyph(open: boolean): string {
  return open ? NERD.sidebarLeft : NERD.sidebarLeftOff;
}

export interface AppHeaderProps {
  onOpenMenu: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  breadcrumb: BreadcrumbItem[];
  rightActions?: React.ReactNode;
  theme?: Theme;
}

export function AppHeader({
  onOpenMenu,
  sidebarOpen,
  onToggleSidebar,
  breadcrumb,
  rightActions,
  theme,
}: AppHeaderProps): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", height: 2, paddingTop: 1, backgroundColor: theme?.panel }}>
      <box style={{ flexGrow: 1, flexDirection: "row", paddingRight: 1 }}>
        <box onMouseUp={onOpenMenu} style={{ paddingRight: 2 }}>
          <text fg={theme?.textMuted}>{NERD.settings}</text>
        </box>
        <IconButton
          glyph={sidebarToggleGlyph(sidebarOpen)}
          onPress={onToggleSidebar}
          marginRight={2}
          theme={theme}
        />
        <Breadcrumb items={breadcrumb} theme={theme} />
        <box style={{ flexGrow: 1 }} />
        {rightActions}
      </box>
    </box>
  );
}
