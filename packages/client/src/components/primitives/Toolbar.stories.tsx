import React from "react";
import type { Story, StoryMeta } from "../story";
import { Button } from "./Button";
import { Toolbar } from "./Toolbar";

export const meta: StoryMeta = { title: "primitives/Toolbar" };

export const ActionRow: Story = {
  render: () => (
    <Toolbar>
      <Button variant="solid" marginRight={2} onPress={() => {}}>
        {" Submit "}
      </Button>
      <Button onPress={() => {}}>{" Cancel "}</Button>
    </Toolbar>
  ),
};
