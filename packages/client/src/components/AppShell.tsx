// The one app shell: a single header row over four full-height panes - Threads, Thread, Changes,
// Project - divided by straight rules; each header cell's thin bottom rule shares the divider gray so
// the whole header underline reads as one line joining the side rules.
// The right region (Changes + Project) toggles as a unit: the Project pane is the right sidebar and is
// always present when the region is on, Changes rides on top of it, and a thin rail holds the sidebar
// toggle when the region is closed. Each pane owns its own header controls; the thread header never does.

import React from "react";
import { DARK, type Theme } from "../theme";
import { PanelColumn } from "./PanelColumn";
import { IconButton } from "./primitives/IconButton";
import { NERD, HEADER_UNDERLINE_CHARS } from "./primitives/icons";
import { TooltipProvider } from "./Tooltip";

export type ProjectPanelMode = "changes" | "tree";

export interface AppShellProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenMenu: () => void;
  threadsPanel: React.ReactNode;
  /** The Thread header title; mirrors the selected sidebar thread, blank on a bare launch. */
  threadTitle: string;
  /** Owner actions at the right edge of the Thread header (Edit/Share) - the only thread-header controls. */
  threadActions?: React.ReactNode;
  threadPanel: React.ReactNode;
  changesOpen: boolean;
  projectOpen: boolean;
  /** Toggle the Changes editor (also switches the Project tree to changed-files mode). */
  onToggleChanges: () => void;
  /** Toggle the Project tree to the full project view. */
  onToggleProject: () => void;
  /** Open or close the whole right region (the right sidebar). */
  onToggleRight: () => void;
  projectMode: ProjectPanelMode;
  /** The Changes editor grid; rendered only when changesOpen. */
  changesPanel?: React.ReactNode;
  projectPanel: React.ReactNode;
  /** Hide the Thread pane so Changes fills the middle (zoom); the sidebars stay. */
  zoomHideThread?: boolean;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  theme?: Theme;
  threadsWidth?: number;
  projectWidth?: number;
}

export function AppShell({
  sidebarOpen,
  onToggleSidebar,
  onOpenMenu,
  threadsPanel,
  threadTitle,
  threadActions,
  threadPanel,
  changesOpen,
  projectOpen,
  onToggleChanges,
  onToggleProject,
  onToggleRight,
  projectMode,
  changesPanel,
  projectPanel,
  zoomHideThread,
  footer,
  children,
  theme,
  threadsWidth = 30,
  projectWidth = 32,
}: AppShellProps): React.ReactNode {
  const tokens = theme ?? DARK;

  // gear + sidebar toggle + product mark: global chrome, in the Threads header when open, else at the
  // left of the Thread header when the Threads pane is collapsed
  const brandChrome = (
    <box style={{ flexDirection: "row" }}>
      <box onMouseUp={onOpenMenu} style={{ paddingRight: 2 }}>
        <text fg={tokens.textMuted}>{NERD.settings}</text>
      </box>
      <IconButton
        glyph={sidebarOpen ? NERD.sidebarLeft : NERD.sidebarLeftOff}
        onPress={onToggleSidebar}
        tip="Toggle Threads"
        marginRight={2}
        theme={tokens}
      />
      <text fg={tokens.accent}>cueloop</text>
    </box>
  );

  const projectToggles = (
    <box style={{ flexDirection: "row" }}>
      <IconButton
        glyph={NERD.diff}
        active={projectMode === "changes"}
        onPress={onToggleChanges}
        tip="Toggle Changes Panel"
        marginRight={2}
        theme={tokens}
      />
      <IconButton
        glyph={NERD.listTree}
        active={projectMode === "tree"}
        onPress={onToggleProject}
        tip="Toggle Project Panel"
        marginRight={2}
        theme={tokens}
      />
      <IconButton
        glyph={NERD.sidebarRight}
        onPress={onToggleRight}
        tip="Toggle Right Sidebar"
        theme={tokens}
      />
    </box>
  );

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: tokens.background,
      }}
    >
      <TooltipProvider theme={tokens}>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        {sidebarOpen ? (
          <PanelColumn width={threadsWidth} border="right" header={brandChrome} theme={tokens}>
            {threadsPanel}
          </PanelColumn>
        ) : null}
        {!zoomHideThread ? (
          <PanelColumn
            header={
              <box style={{ flexDirection: "row" }}>
                {!sidebarOpen ? <box style={{ paddingRight: 2 }}>{brandChrome}</box> : null}
                {threadTitle ? <text fg={tokens.textDim}>{threadTitle}</text> : null}
              </box>
            }
            headerRight={threadActions}
            theme={tokens}
          >
            {threadPanel}
          </PanelColumn>
        ) : null}
        {changesOpen ? (
          <box
            style={{
              flexDirection: "column",
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              borderStyle: "single",
              border: ["left"],
              borderColor: tokens.border,
            }}
          >
            {changesPanel}
          </box>
        ) : null}
        {projectOpen ? (
          <PanelColumn
            width={projectWidth}
            border="left"
            header={null}
            headerRight={projectToggles}
            theme={tokens}
          >
            {projectPanel}
          </PanelColumn>
        ) : (
          // collapsed: a divider tick above the continuous header underline holds the reopen toggle;
          // the rule lives in the header only, never running the pane's full height
          <box style={{ flexDirection: "column", width: 3 }}>
            <box
              customBorderChars={HEADER_UNDERLINE_CHARS}
              style={{
                flexDirection: "row",
                alignItems: "center",
                height: 2,
                backgroundColor: tokens.panel,
                borderStyle: "single",
                border: ["bottom"],
                borderColor: tokens.border,
              }}
            >
              <text fg={tokens.border}>{"│"}</text>
              <IconButton
                glyph={NERD.sidebarRightOff}
                onPress={onToggleRight}
                tip="Toggle Right Sidebar"
                marginLeft={1}
                theme={tokens}
              />
            </box>
          </box>
        )}
      </box>
      {footer !== undefined ? (
        <box
          style={{
            flexDirection: "row",
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            borderStyle: "single",
            border: ["top"],
            borderColor: tokens.border,
          }}
        >
          {footer}
        </box>
      ) : null}
      {children}
      </TooltipProvider>
    </box>
  );
}
