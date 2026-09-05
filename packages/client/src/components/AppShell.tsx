// The one app shell: a grid of four full-height panes - Threads, Thread, Changes, Project - each
// stacking a header cell over its body. The vertical rules run through the header and every header
// cell's bottom rule joins into one brand-accent underline, so the header reads the same across
// every view. The shell owns the stable chrome (menu gear, panel toggles, mode switch); each caller
// fills only the variable slots (the thread title, the file tab, the pane bodies).

import React from "react";
import { DARK, type Theme } from "../theme";
import { PanelColumn } from "./PanelColumn";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";

export type ProjectPanelMode = "changes" | "tree";

export interface AppShellProps {
  /** Threads pane visibility, shared across views so a thread open preserves the sidebar. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Opens the settings dialog from the gear in the Threads header. */
  onOpenMenu: () => void;
  threadsPanel: React.ReactNode;
  /** The Thread header title; mirrors the selected sidebar thread, blank on a bare launch. */
  threadTitle: string;
  /** Owner actions at the right edge of the Thread header (Edit/Share). */
  threadActions?: React.ReactNode;
  threadPanel: React.ReactNode;
  /** Omit changesTab to drop the Changes pane entirely (a view with no file open). */
  changesOpen?: boolean;
  onToggleChanges?: () => void;
  /** The Changes header rendered as a file tab (Welcome on a bare launch). */
  changesTab?: React.ReactNode;
  changesPanel?: React.ReactNode;
  projectOpen: boolean;
  onToggleProject: () => void;
  /** The Project navigator mode: changed files only, or the full project tree. */
  projectMode: ProjectPanelMode;
  onProjectMode: (mode: ProjectPanelMode) => void;
  projectPanel: React.ReactNode;
  footer?: React.ReactNode;
  /** Overlays that float above the grid (settings, dialogs). */
  children?: React.ReactNode;
  theme?: Theme;
  threadsWidth?: number;
  changesWidth?: number;
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
  onToggleChanges,
  changesTab,
  changesPanel,
  projectOpen,
  onToggleProject,
  projectMode,
  onProjectMode,
  projectPanel,
  footer,
  children,
  theme,
  threadsWidth = 30,
  changesWidth = 52,
  projectWidth = 30,
}: AppShellProps): React.ReactNode {
  const tokens = theme ?? DARK;

  // gear + sidebar toggle + product mark: global chrome, so it rides in the Threads
  // header when the pane is open and slides to the left of the Thread header when it collapses
  const brandChrome = (
    <box style={{ flexDirection: "row" }}>
      <box onMouseUp={onOpenMenu} style={{ paddingRight: 2 }}>
        <text fg={tokens.textMuted}>{NERD.settings}</text>
      </box>
      <IconButton
        glyph={sidebarOpen ? NERD.sidebarLeft : NERD.sidebarLeftOff}
        onPress={onToggleSidebar}
        marginRight={2}
        theme={tokens}
      />
      <text fg={tokens.accent}>cueloop</text>
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
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        {sidebarOpen ? (
          <PanelColumn width={threadsWidth} border="right" header={brandChrome} theme={tokens}>
            {threadsPanel}
          </PanelColumn>
        ) : null}
        <PanelColumn
          header={
            <box style={{ flexDirection: "row" }}>
              {!sidebarOpen ? <box style={{ paddingRight: 2 }}>{brandChrome}</box> : null}
              {threadTitle ? <text fg={tokens.textDim}>{threadTitle}</text> : null}
            </box>
          }
          headerRight={
            <box style={{ flexDirection: "row" }}>
              {threadActions}
              {changesTab !== undefined && !changesOpen && onToggleChanges ? (
                <IconButton
                  glyph={NERD.diff}
                  onPress={onToggleChanges}
                  marginRight={1}
                  theme={tokens}
                />
              ) : null}
              {!projectOpen ? (
                <IconButton glyph={NERD.listTree} onPress={onToggleProject} theme={tokens} />
              ) : null}
            </box>
          }
          theme={tokens}
        >
          {threadPanel}
        </PanelColumn>
        {changesTab !== undefined && changesOpen ? (
          <PanelColumn
            width={changesWidth}
            border="left"
            header={changesTab}
            headerRight={
              onToggleChanges ? (
                <IconButton glyph={NERD.sidebarRight} onPress={onToggleChanges} theme={tokens} />
              ) : null
            }
            theme={tokens}
          >
            {changesPanel}
          </PanelColumn>
        ) : null}
        {projectOpen ? (
          <PanelColumn
            width={projectWidth}
            border="left"
            header={null}
            headerRight={
              <box style={{ flexDirection: "row" }}>
                <IconButton
                  glyph={NERD.diff}
                  active={projectMode === "changes"}
                  onPress={() => onProjectMode("changes")}
                  marginRight={1}
                  theme={tokens}
                />
                <IconButton
                  glyph={NERD.listTree}
                  active={projectMode === "tree"}
                  onPress={() => onProjectMode("tree")}
                  marginRight={1}
                  theme={tokens}
                />
                <IconButton glyph={NERD.sidebarRight} onPress={onToggleProject} theme={tokens} />
              </box>
            }
            theme={tokens}
          >
            {projectPanel}
          </PanelColumn>
        ) : null}
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
    </box>
  );
}
