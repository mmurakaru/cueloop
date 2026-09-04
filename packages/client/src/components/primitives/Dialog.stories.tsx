import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { Dialog } from "./Dialog";

export const meta: StoryMeta = { title: "Primitives/Dialog" };

export const Open: Story = {
  render: () => (
    <Dialog isOpen title=" a modal " width={40} height={8}>
      <text>dialog body content</text>
    </Dialog>
  ),
  expectedColors: [DARK.accent],
  size: { width: 60, height: 16 },
};

export const Closed: Story = {
  render: () => (
    <Dialog isOpen={false} title=" hidden " width={40} height={8}>
      <text>never rendered</text>
    </Dialog>
  ),
};
