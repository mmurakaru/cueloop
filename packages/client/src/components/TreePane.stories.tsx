import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { TreePane } from "./TreePane";
import type { TreeRow } from "../tree-view";

export const meta: StoryMeta = { title: "Surfaces/TreePane" };

const callbacks = {
  onSelect: () => {},
  onGo: () => {},
  onBranch: () => {},
  onLabel: () => {},
  onFork: () => {},
  onForkAndShare: () => {},
};

/** rev1 -> comment (labelled, a branch hangs off it) -> the branch's comment -> rev2 as main's tip. */
const ROWS: TreeRow[] = [
  {
    entryId: "e1",
    depth: 0,
    glyph: "◉",
    text: "revision 1",
    onPath: true,
    tips: [],
    isCurrentTip: false,
  },
  {
    entryId: "e2",
    depth: 0,
    glyph: "·",
    text: "comment",
    onPath: true,
    tips: [],
    isCurrentTip: false,
    label: "start",
  },
  {
    entryId: "e3",
    depth: 1,
    glyph: "·",
    text: "comment",
    onPath: false,
    tips: ["alt"],
    isCurrentTip: false,
  },
  {
    entryId: "e4",
    depth: 0,
    glyph: "◉",
    text: "revision 2",
    onPath: true,
    tips: ["main"],
    isCurrentTip: true,
  },
];

/** The rail expects a height-constrained parent, like the app's main row. */
function PaneFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box
      style={{ flexDirection: "column", width: 40, height: "100%", backgroundColor: DARK.panel }}
    >
      {children}
    </box>
  );
}

export const OwnerWithBranch: Story = {
  render: () => (
    <PaneFrame>
      <TreePane rows={ROWS} selectedEntryId="e2" canMove canFork {...callbacks} />
    </PaneFrame>
  ),
  expectedColors: [DARK.accent],
  size: { width: 40, height: 16 },
};

export const CollaboratorReadsOnly: Story = {
  render: () => (
    <PaneFrame>
      <TreePane rows={ROWS} canMove={false} canFork={false} {...callbacks} />
    </PaneFrame>
  ),
  size: { width: 40, height: 16 },
};

/** A resolved review: the owner can still fork, not move. */
export const ResolvedForkOnly: Story = {
  render: () => (
    <PaneFrame>
      <TreePane rows={ROWS} canMove={false} canFork {...callbacks} />
    </PaneFrame>
  ),
  size: { width: 40, height: 16 },
};

export const NoHistory: Story = {
  render: () => (
    <PaneFrame>
      <TreePane rows={[]} canMove canFork {...callbacks} />
    </PaneFrame>
  ),
  size: { width: 40, height: 8 },
};
