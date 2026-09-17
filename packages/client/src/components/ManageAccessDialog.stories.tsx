import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ManageAccessDialog } from "./ManageAccessDialog";

export const meta: StoryMeta = { title: "Dialogs/ManageAccess" };

export const WithHandles: Story = {
  render: () => (
    <ManageAccessDialog
      isOpen
      logins={["octocat", "hubot"]}
      onAdd={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
      theme={DARK}
    />
  ),
  size: { width: 60, height: 18 },
};

export const Empty: Story = {
  render: () => (
    <ManageAccessDialog
      isOpen
      logins={[]}
      onAdd={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
      theme={DARK}
    />
  ),
  size: { width: 60, height: 18 },
};
