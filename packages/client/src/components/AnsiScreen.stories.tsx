import React from "react";
import type { Story, StoryMeta } from "./story";
import { AnsiScreen } from "./AnsiScreen";

export const meta: StoryMeta = { title: "Primitives/AnsiScreen" };

const POSITIONED = "\x1b[2;4HHello from\x1b[4;6Hraw, positioned ANSI";

export const Positioned: Story = {
  render: () => <AnsiScreen ansi={POSITIONED} cols={40} rows={6} />,
  size: { width: 44, height: 8 },
};
