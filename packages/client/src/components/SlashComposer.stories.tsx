import React from "react";
import { DARK } from "../theme";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import type { Story, StoryMeta } from "./story";
import { SlashComposer } from "./SlashComposer";

export const meta: StoryMeta = { title: "Chrome/SlashComposer" };

export const Empty: Story = {
  render: () => (
    <box style={{ width: 60, height: 8, paddingLeft: 1, backgroundColor: DARK.panel }}>
      <SlashComposer
        seed=""
        glyph="●"
        quickActions={DEFAULT_QUICK_ACTIONS}
        tokens={DARK}
        onSubmit={() => {}}
      />
    </box>
  ),
  size: { width: 60, height: 8 },
};

export const WithDraft: Story = {
  render: () => (
    <box style={{ width: 60, height: 8, paddingLeft: 1, backgroundColor: DARK.panel }}>
      <SlashComposer
        seed="looks good, ship it"
        glyph="●"
        quickActions={DEFAULT_QUICK_ACTIONS}
        tokens={DARK}
        onSubmit={() => {}}
      />
    </box>
  ),
  size: { width: 60, height: 8 },
};
