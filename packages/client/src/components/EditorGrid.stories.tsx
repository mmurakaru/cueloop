import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { EditorGrid } from "./EditorGrid";
import { changesTab, fileTab, makeGroup, splitGroup, type EditorTab } from "./editor-grid";

export const meta: StoryMeta = { title: "Surfaces/EditorGrid" };

const noop = (): void => {};

function renderTab(tab: EditorTab): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.textMuted}>{tab.kind === "changes" ? "the whole diff" : tab.path}</text>
    </box>
  );
}

const oneGroup = makeGroup([changesTab(), fileTab("App.tsx", "src/App.tsx", "diff")]);
const sourceGroup = makeGroup([fileTab("plugin.json", ".claude-plugin/plugin.json", "contents")]);
const splitTree = splitGroup(sourceGroup, sourceGroup.id, "right").tree;

export const OneGroup: Story = {
  render: () => (
    <EditorGrid
      tree={oneGroup}
      focusedGroupId={oneGroup.id}
      onFocusGroup={noop}
      onActivateTab={noop}
      onCloseTab={noop}
      onSplit={noop}
      onZoom={noop}
      zoomed={false}
      renderTab={renderTab}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.accent, DARK.border],
  size: { width: 80, height: 16 },
};

export const SplitGroups: Story = {
  render: () => (
    <EditorGrid
      tree={splitTree}
      focusedGroupId={null}
      onFocusGroup={noop}
      onActivateTab={noop}
      onCloseTab={noop}
      onSplit={noop}
      onZoom={noop}
      zoomed={false}
      renderTab={renderTab}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.accent, DARK.border],
  size: { width: 100, height: 16 },
};
