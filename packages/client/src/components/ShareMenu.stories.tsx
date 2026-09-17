import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { MenuControlProvider, useMenuControlState } from "./menu-control";
import { RootOverlayProvider } from "./RootOverlay";
import { ShareMenu } from "./ShareMenu";

export const meta: StoryMeta = { title: "Chrome/ShareMenu" };

/** The share control needs the menu-control and overlay providers the header gives it. */
function ShareMenuFrame(): React.ReactNode {
  const menuControl = useMenuControlState();

  return (
    <box style={{ width: 40, height: 6, paddingLeft: 2, backgroundColor: DARK.panel }}>
      <MenuControlProvider value={menuControl}>
        <RootOverlayProvider>
          <ShareMenu onPublicShare={() => {}} onPrivateShare={() => {}} theme={DARK} />
        </RootOverlayProvider>
      </MenuControlProvider>
    </box>
  );
}

export const Closed: Story = {
  render: () => <ShareMenuFrame />,
  size: { width: 40, height: 6 },
};
