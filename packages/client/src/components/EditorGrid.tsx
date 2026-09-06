// Renders the Changes pane's editor grid: recursive branches split into rows/columns, each leaf an
// editor group with its own tab strip and header controls. The caller supplies renderTab so the grid
// stays layout-only - a tab becomes a diff, a file's contents, or the aggregate Changes view upstream.

import React, { useState } from "react";
import { DARK, type Theme } from "../theme";
import { IconButton } from "./primitives/IconButton";
import { NERD, HEADER_UNDERLINE_CHARS } from "./primitives/icons";
import type { EditorGroup, EditorNode, EditorTab, SplitDirection } from "./editor-grid";

export interface EditorGridProps {
  tree: EditorNode;
  focusedGroupId: string | null;
  onFocusGroup: (groupId: string) => void;
  onActivateTab: (groupId: string, tabId: string) => void;
  onCloseTab: (groupId: string, tabId: string) => void;
  onSplit: (groupId: string, direction: SplitDirection) => void;
  onZoom: () => void;
  zoomed: boolean;
  renderTab: (tab: EditorTab) => React.ReactNode;
  theme?: Theme;
}

const SPLIT_ITEMS: ReadonlyArray<{ label: string; direction: SplitDirection; arrow: string }> = [
  { label: "Split Left", direction: "left", arrow: "←" },
  { label: "Split Right", direction: "right", arrow: "→" },
  { label: "Split Up", direction: "up", arrow: "↑" },
  { label: "Split Down", direction: "down", arrow: "↓" },
];

function EditorTabButton({
  tab,
  active,
  onSelect,
  onClose,
  tokens,
}: {
  tab: EditorTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  tokens: Theme;
}): React.ReactNode {
  const [hovered, setHovered] = useState(false);

  return (
    <box
      onMouseUp={onSelect}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: active ? tokens.background : undefined,
        borderStyle: "single",
        border: ["right"],
        borderColor: tokens.border,
      }}
    >
      <text fg={active ? tokens.accent : tokens.textDim}>{tab.label}</text>
      <box
        onMouseUp={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{ paddingLeft: 1 }}
      >
        <text fg={tokens.textDim}>{hovered ? NERD.close : " "}</text>
      </box>
    </box>
  );
}

function SplitMenu({
  onPick,
  tokens,
}: {
  onPick: (direction: SplitDirection) => void;
  tokens: Theme;
}): React.ReactNode {
  return (
    <box
      style={{
        flexDirection: "column",
        flexShrink: 0,
        borderStyle: "single",
        borderColor: tokens.border,
        backgroundColor: tokens.elevated,
      }}
    >
      {SPLIT_ITEMS.map((item) => (
        <box
          key={item.direction}
          onMouseUp={() => onPick(item.direction)}
          style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1 }}
        >
          <text fg={tokens.text}>{item.label}</text>
          <box style={{ flexGrow: 1 }} />
          <text fg={tokens.textDim}>{` ${item.arrow}`}</text>
        </box>
      ))}
    </box>
  );
}

function EditorGroupPane({
  group,
  focused,
  props,
}: {
  group: EditorGroup;
  focused: boolean;
  props: EditorGridProps;
}): React.ReactNode {
  const tokens = props.theme ?? DARK;
  const [menuOpen, setMenuOpen] = useState(false);
  const active = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  const isFile = active?.kind === "file";

  return (
    <box
      onMouseDown={() => props.onFocusGroup(group.id)}
      style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}
    >
      <box
        customBorderChars={HEADER_UNDERLINE_CHARS}
        style={{
          flexDirection: "row",
          height: 2,
          backgroundColor: focused ? tokens.elevated : tokens.panel,
          borderStyle: "single",
          border: ["bottom"],
          borderColor: tokens.border,
        }}
      >
        <box style={{ flexDirection: "row" }}>
          {group.tabs.map((tab) => (
            <EditorTabButton
              key={tab.id}
              tab={tab}
              active={tab.id === active?.id}
              onSelect={() => props.onActivateTab(group.id, tab.id)}
              onClose={() => props.onCloseTab(group.id, tab.id)}
              tokens={tokens}
            />
          ))}
        </box>
        <box style={{ flexGrow: 1 }} />
        <box style={{ flexDirection: "row", paddingRight: 1 }}>
          <IconButton
            glyph={NERD.search}
            onPress={() => {}}
            tip="Search"
            marginRight={1}
            theme={tokens}
          />
          <IconButton
            glyph={NERD.zoom}
            active={props.zoomed}
            onPress={props.onZoom}
            tip={props.zoomed ? "Zoom Out" : "Zoom In"}
            marginRight={isFile ? 1 : 0}
            theme={tokens}
          />
          {isFile ? (
            <IconButton
              glyph={NERD.split}
              active={menuOpen}
              onPress={() => setMenuOpen((open) => !open)}
              tip="Split Pane"
              theme={tokens}
            />
          ) : null}
        </box>
      </box>
      {menuOpen ? (
        <SplitMenu
          onPick={(direction) => {
            setMenuOpen(false);
            props.onSplit(group.id, direction);
          }}
          tokens={tokens}
        />
      ) : null}
      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        {active ? props.renderTab(active) : null}
      </box>
    </box>
  );
}

function GridNode({ node, props }: { node: EditorNode; props: EditorGridProps }): React.ReactNode {
  if (node.type === "group") {
    return (
      <EditorGroupPane group={node} focused={node.id === props.focusedGroupId} props={props} />
    );
  }
  const tokens = props.theme ?? DARK;
  const horizontal = node.orientation === "horizontal";
  return (
    <box
      style={{
        flexDirection: horizontal ? "row" : "column",
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {node.children.map((child, index) => (
        <React.Fragment key={child.id}>
          {index > 0 ? (
            <box
              style={{
                borderStyle: "single",
                border: [horizontal ? "left" : "top"],
                borderColor: tokens.border,
              }}
            />
          ) : null}
          <box
            style={{
              flexDirection: "column",
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <GridNode node={child} props={props} />
          </box>
        </React.Fragment>
      ))}
    </box>
  );
}

/** The Changes pane body: the editor grid of groups and splits, each rendering its active tab. */
export function EditorGrid(props: EditorGridProps): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <GridNode node={props.tree} props={props} />
    </box>
  );
}
