import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { MenuControlProvider, useMenuControl } from "./menu-control";

export const meta: StoryMeta = { title: "Layout/MenuControl" };

// One open menu at a time: with "alpha" open, only its row reads as open.
function MenuControlDemo(): React.ReactNode {
  const { openMenuId } = useMenuControl();
  const row = (id: string): React.ReactNode => (
    <text fg={openMenuId === id ? DARK.accent : DARK.textDim}>
      {`${id}: ${openMenuId === id ? "open" : "closed"}`}
    </text>
  );

  return (
    <box style={{ flexDirection: "column" }}>
      {row("alpha")}
      {row("beta")}
    </box>
  );
}

export const OneOpenAtATime: Story = {
  render: () => (
    <MenuControlProvider value={{ openMenuId: "alpha", toggleMenu: () => {}, closeMenu: () => {} }}>
      <box style={{ padding: 1, backgroundColor: DARK.panel }}>
        <MenuControlDemo />
      </box>
    </MenuControlProvider>
  ),
  expectedColors: [DARK.accent],
  size: { width: 30, height: 5 },
};
