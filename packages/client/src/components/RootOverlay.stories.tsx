import React, { useEffect } from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { RootOverlayProvider, useRootOverlay } from "./RootOverlay";

export const meta: StoryMeta = { title: "Layout/RootOverlay" };

// The provider renders whatever a descendant pushes after the rest of the tree, so it draws on top.
function OverlayDemo(): React.ReactNode {
  const { setOverlay } = useRootOverlay();

  useEffect(() => {
    setOverlay(
      <box
        style={{
          position: "absolute",
          top: 2,
          left: 6,
          borderStyle: "single",
          borderColor: DARK.border,
          backgroundColor: DARK.elevated,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={DARK.text}>floating overlay</text>
      </box>,
    );
  }, [setOverlay]);

  return <text fg={DARK.textDim}>base content under the overlay</text>;
}

export const FloatingNode: Story = {
  render: () => (
    <RootOverlayProvider>
      <box style={{ padding: 1, backgroundColor: DARK.panel }}>
        <OverlayDemo />
      </box>
    </RootOverlayProvider>
  ),
  expectedColors: [DARK.text],
  size: { width: 40, height: 6 },
};
