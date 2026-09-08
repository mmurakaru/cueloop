import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { Breadcrumb } from "./Breadcrumb";

export const meta: StoryMeta = { title: "Chrome/Breadcrumb" };

export const SessionHeader: Story = {
  render: () => (
    <Breadcrumb
      items={[
        { label: "cueloop", tone: "accent" },
        { label: "Migration Plan · rev 2", tone: "dim" },
        { label: "resolved: approve", tone: "green" },
      ]}
    />
  ),
  expectedColors: [DARK.accent, DARK.green],
};
