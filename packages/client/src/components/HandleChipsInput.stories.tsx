import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { HandleChipsInput } from "./HandleChipsInput";

export const meta: StoryMeta = { title: "Inputs/HandleChips" };

export const WithHandles: Story = {
  render: () => (
    <box style={{ padding: 1, backgroundColor: DARK.elevated }}>
      <HandleChipsInput logins={["octocat", "hubot"]} onChange={() => {}} theme={DARK} />
    </box>
  ),
  size: { width: 48, height: 6 },
};

export const Empty: Story = {
  render: () => (
    <box style={{ padding: 1, backgroundColor: DARK.elevated }}>
      <HandleChipsInput logins={[]} onChange={() => {}} theme={DARK} />
    </box>
  ),
  size: { width: 48, height: 6 },
};
