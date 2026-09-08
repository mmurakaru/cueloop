// Renders the Changes pane's editor grid: recursive branches split into rows/columns, each leaf an
// editor group with its own tab strip and header controls. The caller supplies renderTab so the grid
// stays layout-only - a tab becomes a diff, a file's contents, or the aggregate Changes view upstream.

import React, { useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { DARK, type Theme } from "../theme";
import { useFrameMeasure } from "../use-frame-measure";
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
  /** The body of a group's active tab; `groupFocused` tells a keyboard-owning body whether it has the keys. */
  renderTab: (tab: EditorTab, groupFocused: boolean) => React.ReactNode;
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
      id={tab.id}
      onMouseUp={onSelect}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      style={{
        flexDirection: "row",
        // a tab keeps the width of its name; the strip scrolls when the row overflows
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: active ? tokens.background : undefined,
        borderStyle: "single",
        border: ["right"],
        borderColor: tokens.border,
      }}
    >
      <text fg={active ? tokens.textMuted : tokens.textDim} style={{ wrapMode: "none" }}>
        {tab.label}
      </text>
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

/** Cells a tab occupies: its padding, the label, the close cell and its padding, the right rule. */
function tabCellWidth(tab: EditorTab): number {
  return tab.label.length + 5;
}

/** The run of tabs `[first, end)` the strip shows. */
export interface TabWindow {
  first: number;
  end: number;
}

/** The run of tabs that fits the strip and contains the active tab; markers take a cell each side. */
export function visibleTabWindow(
  tabs: EditorTab[],
  firstVisible: number,
  activeIndex: number,
  stripWidth: number,
): TabWindow {
  // unmeasured strip: show everything, the header clips until the width is known
  if (stripWidth <= 0) return { first: 0, end: tabs.length };
  const fitEnd = (first: number): number => {
    let used = first > 0 ? 1 : 0;
    let end = first;

    while (end < tabs.length) {
      const remaining = end + 1 < tabs.length ? 1 : 0;

      if (used + tabCellWidth(tabs[end]!) + remaining > stripWidth) break;
      used += tabCellWidth(tabs[end]!);
      end++;
    }

    // always show at least the tab the window starts on, even when it is wider than the strip
    return Math.max(end, Math.min(first + 1, tabs.length));
  };
  let first = Math.min(Math.max(0, firstVisible), Math.max(0, activeIndex));
  let end = fitEnd(first);

  // the active tab past the right edge pulls the window along until it fits
  while (activeIndex >= end && first < activeIndex) {
    first++;
    end = fitEnd(first);
  }

  return { first, end };
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
        // the panel token is transparent in the branded theme, so the menu reads terminal-through
        backgroundColor: tokens.panel,
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
  props,
}: {
  group: EditorGroup;
  props: EditorGridProps;
}): React.ReactNode {
  const tokens = props.theme ?? DARK;
  const [menuOpen, setMenuOpen] = useState(false);
  const active = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  const isFile = active?.kind === "file";
  // The strip windows its tabs rather than scrolling a nested scrollbox (which stalls the
  // renderer inside this header): tabs keep the width of their names, only the run that fits
  // renders, and the window follows the active tab so a tab opened past the edge is never hidden.
  const stripRef = useRef<BoxRenderable | null>(null);
  const stripWidth = useFrameMeasure(
    () => stripRef.current?.width ?? 0,
    (left, right) => left === right,
    0,
  );
  const [firstVisible, setFirstVisible] = useState(0);
  const activeIndex = Math.max(
    0,
    group.tabs.findIndex((tab) => tab.id === active?.id),
  );
  // derived every render: the manual offset is a floor the active tab can pull the window past
  const tabWindow = visibleTabWindow(group.tabs, firstVisible, activeIndex, stripWidth);

  return (
    <box
      onMouseDown={() => props.onFocusGroup(group.id)}
      style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}
    >
      <box
        customBorderChars={HEADER_UNDERLINE_CHARS}
        style={{
          flexDirection: "row",
          // pin the controls to the right edge so their column never shifts with the container
          // width parity; a lone flexGrow tab strip would drag them a cell on zoom
          justifyContent: "space-between",
          height: 2,
          // match the pane headers: the panel token is transparent in the branded theme, so the
          // header reads as terminal-through rather than a raised box
          backgroundColor: tokens.panel,
          borderStyle: "single",
          border: ["bottom"],
          borderColor: tokens.border,
        }}
      >
        {/* the tab strip windows its tabs: the run that fits renders in full, edge markers step
            the window, and the controls stay pinned on the right */}
        <box
          ref={stripRef}
          style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}
        >
          {tabWindow.first > 0 ? (
            <box onMouseUp={() => setFirstVisible(tabWindow.first - 1)} style={{ flexShrink: 0 }}>
              <text fg={tokens.textDim}>{"‹"}</text>
            </box>
          ) : null}
          {group.tabs.slice(tabWindow.first, tabWindow.end).map((tab) => (
            <EditorTabButton
              key={tab.id}
              tab={tab}
              active={tab.id === active?.id}
              onSelect={() => props.onActivateTab(group.id, tab.id)}
              onClose={() => props.onCloseTab(group.id, tab.id)}
              tokens={tokens}
            />
          ))}
          {tabWindow.end < group.tabs.length ? (
            <box onMouseUp={() => setFirstVisible(tabWindow.first + 1)} style={{ flexShrink: 0 }}>
              <text fg={tokens.textDim}>{"›"}</text>
            </box>
          ) : null}
        </box>
        <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
          <IconButton glyph="search" onPress={() => {}} marginRight={2} theme={tokens} />
          <IconButton
            glyph={NERD.zoom}
            active={props.zoomed}
            onPress={props.onZoom}
            tip={props.zoomed ? "Zoom Out" : "Zoom In"}
            marginRight={isFile ? 2 : 0}
            theme={tokens}
          />
          {isFile ? (
            <IconButton
              glyph="split"
              active={menuOpen}
              onPress={() => setMenuOpen((open) => !open)}
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
        {active ? props.renderTab(active, props.focusedGroupId === group.id) : null}
      </box>
    </box>
  );
}

function GridNode({ node, props }: { node: EditorNode; props: EditorGridProps }): React.ReactNode {
  if (node.type === "group") {
    return <EditorGroupPane group={node} props={props} />;
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
