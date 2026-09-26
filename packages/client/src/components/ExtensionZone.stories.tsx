import React from "react";
import { ClientExtensionRegistry } from "../client-extension-registry";
import type { Story, StoryMeta } from "./story";
import { ExtensionZone } from "./ExtensionZone";

export const meta: StoryMeta = { title: "Extensions/ExtensionZone" };

const registry = new ClientExtensionRegistry();

void registry.load("example", (api) => {
  api.registerSection({
    id: "summary",
    zone: "threads.sidebar",
    title: "Summary",
    Component: () => <text>Two pending Threads</text>,
  });
});

export const SidebarSection: Story = {
  render: () => (
    <ExtensionZone
      zone="threads.sidebar"
      registry={registry}
      context={{ workspace: "/repo", threadId: null }}
    />
  ),
  size: { width: 32, height: 8 },
};
