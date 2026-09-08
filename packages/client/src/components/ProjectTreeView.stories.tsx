import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ProjectTreeView } from "./ProjectTreeView";

export const meta: StoryMeta = { title: "Surfaces/ProjectTreeView" };

const SAMPLE = [
  "packages/client/src/App.tsx",
  "packages/client/src/components/AppShell.tsx",
  "packages/daemon/src/api.ts",
  "README.md",
];

export const Loaded: Story = {
  render: () => (
    <ProjectTreeView
      loadFiles={() => Promise.resolve(SAMPLE)}
      onSelectFile={() => {}}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 40, height: 16 },
};
