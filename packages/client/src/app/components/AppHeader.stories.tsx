import React from "react";
import { DARK } from "../../appearance/theme";
import type { Story, StoryMeta } from "../../stories/story";
import { AppHeader } from "./AppHeader";
import { Button } from "../../ui/components/primitives/Button";
import { Toolbar } from "../../ui/components/primitives/Toolbar";

export const meta: StoryMeta = { title: "Chrome/AppHeader" };

export const NoThread: Story = {
  render: () => (
    <AppHeader
      onOpenMenu={() => {}}
      sidebarOpen
      onToggleSidebar={() => {}}
      title=""
      changesOpen={false}
      onToggleChanges={() => {}}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 80, height: 3 },
};

export const ThreadWithActions: Story = {
  render: () => (
    <AppHeader
      onOpenMenu={() => {}}
      sidebarOpen
      onToggleSidebar={() => {}}
      title="Review the accent change"
      editShare={
        <Toolbar>
          <Button onPress={() => {}} theme={DARK}>
            {" Edit "}
          </Button>
          <Button onPress={() => {}} theme={DARK}>
            {" Share "}
          </Button>
        </Toolbar>
      }
      changesOpen
      onToggleChanges={() => {}}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 80, height: 3 },
};
