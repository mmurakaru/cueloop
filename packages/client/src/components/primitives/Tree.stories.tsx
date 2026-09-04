import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { Tree } from "./Tree";
import type { TreeNode } from "./tree-model";

export const meta: StoryMeta = { title: "Primitives/Tree" };

const FILES: TreeNode[] = [
  {
    id: "packages",
    label: "packages",
    children: [
      {
        id: "schema",
        label: "schema",
        children: [
          { id: "schema/types.ts", label: "types.ts", status: "modified" },
          { id: "schema/tree-model.ts", label: "tree-model.ts", status: "added" },
        ],
      },
      {
        id: "daemon",
        label: "daemon",
        children: [{ id: "daemon/api.ts", label: "api.ts", status: "modified" }],
      },
    ],
  },
  { id: "README.md", label: "README.md" },
  { id: "old.ts", label: "old.ts", status: "deleted" },
];

const DEEP: TreeNode[] = [
  {
    id: "src",
    label: "src",
    children: [
      {
        id: "src/components",
        label: "components",
        children: [
          {
            id: "src/components/primitives",
            label: "primitives",
            children: [
              { id: "src/components/primitives/Tree.tsx", label: "Tree.tsx", status: "added" },
            ],
          },
        ],
      },
    ],
  },
];

const PROJECTS: TreeNode[] = [
  {
    id: "projects",
    label: "Projects",
    children: [
      {
        id: "cueloop",
        label: "cueloop",
        children: [{ id: "cueloop/read", label: "Read Cueloop Repository" }],
      },
    ],
  },
  {
    id: "threads",
    label: "Threads",
    children: [{ id: "threads/welcome", label: "Welcome to cueloop" }],
  },
];

function Frame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box style={{ width: 40, height: "100%", backgroundColor: DARK.panel, paddingTop: 1 }}>
      {children}
    </box>
  );
}

export const FileTree: Story = {
  render: () => (
    <Frame>
      <Tree
        nodes={FILES}
        expandedIds={new Set(["packages", "schema", "daemon"])}
        selectedId="schema/tree-model.ts"
        showStatus
      />
    </Frame>
  ),
  expectedColors: [DARK.accent, DARK.green, DARK.red],
  size: { width: 44, height: 16 },
};

export const FlattenedChain: Story = {
  render: () => (
    <Frame>
      <Tree
        nodes={DEEP}
        expandedIds={new Set(["src", "src/components/primitives"])}
        flattenEmptyDirectories
        showStatus
      />
    </Frame>
  ),
  expectedColors: [DARK.green],
  size: { width: 44, height: 10 },
};

export const ProjectsThreads: Story = {
  render: () => (
    <Frame>
      <Tree
        nodes={PROJECTS}
        expandedIds={new Set(["projects", "cueloop", "threads"])}
        selectedId="cueloop/read"
      />
    </Frame>
  ),
  expectedColors: [DARK.accent],
  size: { width: 44, height: 12 },
};
