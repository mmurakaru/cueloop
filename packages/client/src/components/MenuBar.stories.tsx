import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { MenuBar } from "./MenuBar";

export const meta: StoryMeta = { title: "MenuBar" };

const callbacks = { onToggle: () => {}, onSettings: () => {}, onKeybinds: () => {} };

function BottomFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box
      style={{ flexDirection: "column", width: "100%", height: "100%", justifyContent: "flex-end" }}
    >
      {children}
    </box>
  );
}

export const Closed: Story = {
  render: () => (
    <BottomFrame>
      <MenuBar open={false} version="0.1.0-alpha.32" {...callbacks} />
    </BottomFrame>
  ),
  size: { width: 60, height: 8 },
};

export const Open: Story = {
  render: () => (
    <BottomFrame>
      <MenuBar open version="0.1.0-alpha.32" {...callbacks} />
    </BottomFrame>
  ),
  expectedColors: [DARK.text],
  size: { width: 60, height: 8 },
};
