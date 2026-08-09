import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { Tab, TabList, Tabs } from "./Tabs";

export const meta: StoryMeta = { title: "primitives/Tabs" };

export const TwoTabs: Story = {
  render: () => (
    <Tabs selectedKey="review" onSelectionChange={() => {}}>
      <TabList>
        <Tab id="review">Review (2)</Tab>
        <Tab id="agent">Agent</Tab>
      </TabList>
    </Tabs>
  ),
  expectedColors: [DARK.accent, DARK.textDim],
};

export const SecondSelected: Story = {
  render: () => (
    <Tabs selectedKey="agent" onSelectionChange={() => {}}>
      <TabList>
        <Tab id="review">Review (0)</Tab>
        <Tab id="agent">Agent</Tab>
      </TabList>
    </Tabs>
  ),
};
