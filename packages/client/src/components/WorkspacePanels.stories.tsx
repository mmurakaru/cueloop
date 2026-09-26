import React from "react";
import { ClientExtensionRegistry } from "../client-extension-registry";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { WorkspacePanels } from "./WorkspacePanels";

export const meta: StoryMeta = { title: "Extensions/WorkspacePanels" };

const registry = new ClientExtensionRegistry();

void registry.load("example", (api) => {
  api.registerView({
    id: "details",
    zone: "workspace.panels",
    title: "Details",
    Component: () => <text>Extension details</text>,
  });
});

export const RegisteredView: Story = {
  render: () => (
    <WorkspacePanels
      width={32}
      projectMode="tree"
      projectPanel={<text>Project files</text>}
      onToggleChanges={() => {}}
      onToggleProject={() => {}}
      onToggleRight={() => {}}
      onFocus={() => {}}
      registry={registry}
      context={{ workspace: "/repo", threadId: "thread-1" }}
      theme={DARK}
    />
  ),
  size: { width: 32, height: 10 },
};
