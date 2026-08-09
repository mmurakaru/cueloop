import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ComposeBar } from "./ComposeBar";

export const meta: StoryMeta = { title: "ComposeBar" };

export const CommentOnLine: Story = {
  render: () => (
    <ComposeBar kind="comment" quote="  private items = new Map();" text="Map needs an eviction story." onInput={() => {}} />
  ),
  expectedColors: [DARK.accent, DARK.elevated],
};

export const SuggestionOnLine: Story = {
  render: () => <ComposeBar kind="suggestion" quote="export class Store {" text="" onInput={() => {}} />,
  expectedColors: [DARK.green],
};
