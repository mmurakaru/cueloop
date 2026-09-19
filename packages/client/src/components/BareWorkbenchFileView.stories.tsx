import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { BareWorkbenchFileView, type WorkbenchCommenter } from "./BareWorkbenchFileView";

export const meta: StoryMeta = { title: "Surfaces/BareWorkbenchFileView" };

const SAMPLE = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

const controller: WorkbenchCommenter = {
  repoReadFile: () => Promise.resolve(SAMPLE),
  commentOnWorkbench: () => Promise.resolve(),
};

export const Loaded: Story = {
  render: () => (
    <BareWorkbenchFileView
      path="src/add.ts"
      controller={controller}
      quickActions={[]}
      onExit={() => {}}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 60, height: 12 },
};
