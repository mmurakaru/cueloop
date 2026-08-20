import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { CodeBlock } from "./CodeBlock";

export const meta: StoryMeta = { title: "CodeBlock" };

const SNIPPET = `export function gate(full: number) {
  // threshold
  return full < 0.6 ? "blocked" : "clear";
}`;

export const Typescript: Story = {
  render: () => <CodeBlock language="ts" content={SNIPPET} />,
  expectedColors: [DARK.elevated],
};

export const CursorAnnotatedEdited: Story = {
  render: () => (
    <CodeBlock
      language="ts"
      content={SNIPPET}
      isCursor
      isAnnotated
      changeTag="edited"
      marginTop={1}
    />
  ),
  expectedColors: [DARK.accent],
};

export const UnknownLanguage: Story = {
  render: () => (
    <CodeBlock language="brainfog" content={"plain verbatim lines\n  with indentation"} />
  ),
};

/** A cut code block: struck-through gray content, no [cut] tag. */
export const Cut: Story = {
  render: () => <CodeBlock language="ts" content={SNIPPET} cut />,
  expectedColors: [DARK.elevated],
};
