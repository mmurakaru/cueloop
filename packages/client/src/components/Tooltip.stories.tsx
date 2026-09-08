import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { TooltipProvider } from "./Tooltip";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";

export const meta: StoryMeta = { title: "Layout/Tooltip" };

// The tooltip surfaces only on hover, so a static story shows the provider wrapping a labelled control.
export const HoverControl: Story = {
  render: () => (
    <TooltipProvider theme={DARK}>
      <box style={{ flexDirection: "row", padding: 1, backgroundColor: DARK.panel }}>
        <IconButton
          glyph={NERD.sidebarRight}
          tip="Toggle Right Sidebar"
          onPress={() => {}}
          theme={DARK}
        />
      </box>
    </TooltipProvider>
  ),
  expectedColors: [DARK.textMuted],
  size: { width: 40, height: 4 },
};
