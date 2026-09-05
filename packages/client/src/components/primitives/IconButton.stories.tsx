import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { IconButton } from "./IconButton";
import { NERD } from "./icons";

export const meta: StoryMeta = { title: "Primitives/IconButton" };

function Row({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", padding: 1, backgroundColor: DARK.panel }}>{children}</box>
  );
}

export const States: Story = {
  render: () => (
    <Row>
      <IconButton glyph={NERD.settings} onPress={() => {}} marginRight={3} />
      <IconButton glyph={NERD.listTree} active onPress={() => {}} marginRight={3} />
      <IconButton glyph={NERD.diff} disabled marginRight={3} />
      <IconButton glyph={NERD.submit} onPress={() => {}} />
    </Row>
  ),
  expectedColors: [DARK.accent, DARK.textMuted, DARK.textDim],
  size: { width: 40, height: 3 },
};

export const Submit: Story = {
  render: () => (
    <Row>
      <IconButton glyph={NERD.submit} active onPress={() => {}} />
    </Row>
  ),
  expectedColors: [DARK.accent],
  size: { width: 20, height: 3 },
};
