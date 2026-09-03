import React from "react";
import { DARK } from "../theme";
import { REVIEW_MAX_WIDTH, REVIEW_MIN_WIDTH } from "../review-panel";
import type { Story, StoryMeta } from "./story";
import { ReviewPanel } from "./ReviewPanel";
import { FIXTURE_ANNOTATIONS, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "ReviewPanel" };

/** An empty Tree tab: the stories here show the review tab. */
const tree = {
  rows: [],
  canMove: true,
  onSelect: () => {},
  onGo: () => {},
  onBranch: () => {},
  onLabel: () => {},
  onFork: () => {},
  onForkAndShare: () => {},
};

const rail = {
  session: fixturePlanSession(),
  tree,
  authorNames: {},
  selectedId: FIXTURE_ANNOTATIONS[0]!.id,
  resolvedIds: new Set(FIXTURE_ANNOTATIONS.map((annotation) => annotation.id)),
  curationItems: [],
  railTab: "review" as const,
  pendingCount: 2,
  cardEdit: null,
  submitConfirm: null,
  onTabChange: () => {},
  onSelectCard: () => {},
  onActivateCard: () => {},
  onSelectCuration: () => {},
  onUndoCuration: () => {},
  onSubmitRequest: () => {},
  onLaunchHarness: () => {},
};

const panelCallbacks = { onDividerGrab: () => {}, onToggle: () => {} };

/** The plan area to the left of the divider, so the layout reads in context. */
function PanelFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box
      style={{
        flexDirection: "row",
        width: "100%",
        height: "100%",
        backgroundColor: DARK.background,
      }}
    >
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
      <ReviewPanel mode="expanded" width={REVIEW_MIN_WIDTH} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  size: { width: 80, height: 24 },
};

export const ExpandedWide: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="expanded" width={REVIEW_MAX_WIDTH} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  expectedColors: [DARK.accent],
  size: { width: 90, height: 24 },
};

export const Compact: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="compact" width={34} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  expectedColors: [DARK.accent],
  size: { width: 60, height: 24 },
};

export const Hidden: Story = {
  render: () => (
    <PanelFrame>
      <ReviewPanel mode="hidden" width={34} rail={rail} {...panelCallbacks} />
    </PanelFrame>
  ),
  size: { width: 60, height: 24 },
};
