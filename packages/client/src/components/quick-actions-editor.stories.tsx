import React from "react";
import { DARK } from "../theme";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import type { Story, StoryMeta } from "./story";
import { QuickActionsEditor } from "./quick-actions-editor";

export const meta: StoryMeta = { title: "Chrome/QuickActionsEditor" };

/** The editor renders inside the settings body column. */
function BodyFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box style={{ width: 54, height: 22, paddingLeft: 2, backgroundColor: DARK.elevated }}>
      {children}
    </box>
  );
}

const noop = () => {};

export const Collapsed: Story = {
  render: () => (
    <BodyFrame>
      <QuickActionsEditor
        actions={DEFAULT_QUICK_ACTIONS}
        selectedIndex={0}
        expandedIndex={null}
        onToggleExpand={noop}
        onEditMetadata={noop}
        onReset={noop}
        onAdd={noop}
        theme={DARK}
      />
    </BodyFrame>
  ),
  size: { width: 54, height: 22 },
};

export const RowExpanded: Story = {
  render: () => (
    <BodyFrame>
      <QuickActionsEditor
        actions={DEFAULT_QUICK_ACTIONS}
        selectedIndex={1}
        expandedIndex={1}
        onToggleExpand={noop}
        onEditMetadata={noop}
        onReset={noop}
        onAdd={noop}
        theme={DARK}
      />
    </BodyFrame>
  ),
  size: { width: 54, height: 22 },
};
