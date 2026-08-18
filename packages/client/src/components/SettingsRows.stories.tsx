import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { CycleRow, TextRow, ToggleRow } from "./SettingsRows";

export const meta: StoryMeta = { title: "SettingsRows" };

export const AllKinds: Story = {
  render: () => (
    <box style={{ flexDirection: "column", width: 50 }}>
      <ToggleRow label="Line numbers" value={true} isActive={false} onPress={() => {}} />
      <ToggleRow label="Hide whitespace" value={false} isActive={true} onPress={() => {}} />
      <CycleRow label="Palette" value="dark" isActive={false} onPress={() => {}} />
      <TextRow label="Vault path" value="~/vaults/notes" isActive={false} onPress={() => {}} />
    </box>
  ),
  expectedColors: [DARK.green, DARK.accent, DARK.border],
};
