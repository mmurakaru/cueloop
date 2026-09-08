import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { MenuBar } from "./MenuBar";

export const meta: StoryMeta = { title: "Chrome/MenuBar" };

const callbacks = { onSettings: () => {}, onKeybinds: () => {} };

function BottomFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box
      style={{ flexDirection: "column", width: "100%", height: "100%", justifyContent: "flex-end" }}
    >
      {children}
    </box>
  );
}

export const Open: Story = {
  render: () => (
    <BottomFrame>
      <MenuBar open {...callbacks} />
    </BottomFrame>
  ),
  expectedColors: [DARK.text],
  size: { width: 60, height: 8 },
};
