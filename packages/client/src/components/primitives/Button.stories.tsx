import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { Button } from "./Button";
import { Toolbar } from "./Toolbar";

export const meta: StoryMeta = { title: "primitives/Button" };

export const Variants: Story = {
  render: () => (
    <Toolbar>
      <Button variant="solid" marginRight={2} onPress={() => {}}>
        {" Save ⏎ "}
      </Button>
      <Button marginRight={2} onPress={() => {}}>
        {" Cancel esc "}
      </Button>
      <Button variant="accent-text" onPress={() => {}}>
        {"Submit review (2) ⏎"}
      </Button>
    </Toolbar>
  ),
  expectedColors: [DARK.accent, DARK.accentInk, DARK.textDim],
};

export const Disabled: Story = {
  render: () => (
    <Button isDisabled onPress={() => {}}>
      {" Edit "}
    </Button>
  ),
};
