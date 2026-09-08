import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { FileContentsView } from "./FileContentsView";

export const meta: StoryMeta = { title: "Surfaces/FileContentsView" };

const SAMPLE = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

export const Loaded: Story = {
  render: () => (
    <FileContentsView path="src/add.ts" loadContents={() => Promise.resolve(SAMPLE)} theme={DARK} />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 60, height: 12 },
};
