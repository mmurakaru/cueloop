import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AppHeader } from "./AppHeader";

export const meta: StoryMeta = { title: "Chrome/AppHeader" };

export const NoThread: Story = {
  render: () => (
    <AppHeader
      onOpenMenu={() => {}}
      sidebarOpen
      onToggleSidebar={() => {}}
      breadcrumb={[{ label: "cueloop", tone: "accent" }]}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 60, height: 3 },
};

export const WithBreadcrumb: Story = {
  render: () => (
    <AppHeader
      onOpenMenu={() => {}}
      sidebarOpen={false}
      onToggleSidebar={() => {}}
      breadcrumb={[
        { label: "cueloop", tone: "accent" },
        { label: "Migration Plan · rev 1", tone: "dim" },
      ]}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 60, height: 3 },
};
