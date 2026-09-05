import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PanelColumn, FileTab } from "./PanelColumn";

export const meta: StoryMeta = { title: "Surfaces/PanelColumn" };

export const WithFileTab: Story = {
  render: () => (
    <box style={{ width: "100%", height: "100%", flexDirection: "row" }}>
      <PanelColumn
        width={40}
        border="left"
        header={<FileTab label="Welcome" active onClose={() => {}} theme={DARK} />}
        theme={DARK}
      >
        <box style={{ paddingLeft: 1, paddingTop: 1 }}>
          <text fg={DARK.textDim}>panel body</text>
        </box>
      </PanelColumn>
    </box>
  ),
  expectedColors: [DARK.accent, DARK.border],
  size: { width: 50, height: 8 },
};
