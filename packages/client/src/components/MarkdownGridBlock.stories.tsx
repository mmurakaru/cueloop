import React from "react";
import { DARK } from "../theme";
import { buildDisplay, type DisplayBlock } from "../view-plan";
import type { Story, StoryMeta } from "./story";
import { MarkdownGridBlock } from "./MarkdownGridBlock";

export const meta: StoryMeta = { title: "Surfaces/MarkdownGridBlock" };

/** The first display block of a kind, for a story that renders one grid in isolation. */
function firstBlock(markdown: string, kind: DisplayBlock["kind"]): DisplayBlock {
  return buildDisplay(markdown).find((block) => block.kind === kind)!;
}

const TABLE = firstBlock(
  "| Name | Size |\n| :--- | ---: |\n| daemon | 12 |\n| client | 7 |",
  "table",
);
const FRONTMATTER = firstBlock(
  "---\ntitle: Migration Plan\nowner: platform team\nstatus: in review\n---\n\n# Plan\n",
  "frontmatter",
);

export const Table: Story = {
  render: () => <MarkdownGridBlock block={TABLE} theme={DARK} contentWidth={60} />,
  expectedColors: [DARK.text, DARK.textDim],
  size: { width: 62, height: 6 },
};

export const Frontmatter: Story = {
  render: () => <MarkdownGridBlock block={FRONTMATTER} theme={DARK} contentWidth={60} />,
  expectedColors: [DARK.text, DARK.textDim],
  size: { width: 62, height: 9 },
};
