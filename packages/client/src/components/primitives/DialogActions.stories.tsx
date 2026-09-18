import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { DialogActions } from "./DialogActions";

export const meta: StoryMeta = { title: "Primitives/DialogActions" };

const noop = () => {};

export const SaveCancel: Story = {
  render: () => <DialogActions confirmLabel="save" onConfirm={noop} onCancel={noop} />,
  expectedColors: [DARK.accent],
  size: { width: 40, height: 3 },
};

export const DeleteCancel: Story = {
  render: () => <DialogActions confirmLabel="delete" onConfirm={noop} onCancel={noop} />,
  expectedColors: [DARK.accent],
  size: { width: 40, height: 3 },
};
