import React from "react";
import { DARK } from "../theme";
import { REVIEW_MAX_WIDTH, REVIEW_MIN_WIDTH } from "../review-panel";
import type { Story, StoryMeta } from "./story";
import { ReviewPanel } from "./ReviewPanel";
import { FIXTURE_ANNOTATIONS, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "ReviewPanel" };

const rail = {
  session: fixturePlanSession(),
  authorNames: {},
  selectedId: FIXTURE_ANNOTATIONS[0]!.id,
  resolvedIds: new Set(FIXTURE_ANNOTATIONS.map((annotation) => annotation.id)),
  railTab: "review" as const,
  pendingCount: 2,
  cardEdit: null,
  submitConfirm: null,
  onTabChange: () => {},
  onSelectCard: () => {},
  onActivateCard: () => {},
  onSubmitRequest: () => {},
};

const panelCallbacks = { onDividerGrab: () => {}, onToggle: () => {} };

/** The plan area to the left of the divider, so the layout reads in context. */
function PanelFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", width: "100%", height: "100%", backgroundColor: DARK.bg }}>
      <box style={{ flexGrow: 1, paddingLeft: 1 }}>
        <text fg={DARK.textMuted}>The plan takes the width the panel hands back.</text>
      </box>
      {children}
    </box>
  );
}

export const ExpandedNarrow: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="expanded" width={REVIEW_MIN_WIDTH} height={24} dragging={false} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  expectedColors: [DARK.panel, DARK.border],
  size: { width: 80, height: 24 },
};

export const ExpandedWide: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="expanded" width={REVIEW_MAX_WIDTH} height={24} dragging={false} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  expectedColors: [DARK.panel, DARK.green],
  size: { width: 90, height: 24 },
};

/** Dragging accents the divider glyph column. */
export const DraggingDivider: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="expanded" width={34} height={24} dragging={true} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  expectedColors: [DARK.accent],
  size: { width: 80, height: 24 },
};

export const Compact: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="compact" width={34} height={24} dragging={false} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  expectedColors: [DARK.accent, DARK.green],
  size: { width: 60, height: 24 },
};

export const Hidden: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="hidden" width={34} height={24} dragging={false} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  size: { width: 60, height: 24 },
};
