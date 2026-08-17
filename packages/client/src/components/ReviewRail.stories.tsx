import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ReviewRail } from "./ReviewRail";
import { FIXTURE_ANNOTATIONS, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "ReviewRail" };

const callbacks = {
  onTabChange: () => {},
  onSelectCard: () => {},
  onActivateCard: () => {},
  onSubmitRequest: () => {},
};

/** The rail expects a height-constrained parent, like the app's main row. */
function RailFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ flexDirection: "row", width: "100%", height: "100%" }}>{children}</box>;
}

export const AnnotationStack: Story = {
  render: () => (
    <RailFrame>
      <ReviewRail
      session={fixturePlanSession()}
      authorNames={{}}
      selectedId={FIXTURE_ANNOTATIONS[0]!.id}
      resolvedIds={new Set(FIXTURE_ANNOTATIONS.map((annotation) => annotation.id))}
      railTab="review"
      pendingCount={2}
      cardEdit={null}
      submitConfirm={null}
      {...callbacks}
      />
    </RailFrame>
  ),
  expectedColors: [DARK.green],
  size: { width: 40, height: 24 },
};

export const AgentTab: Story = {
  render: () => (
    <RailFrame>
      <ReviewRail
      session={fixturePlanSession()}
      authorNames={{}}
      resolvedIds={new Set()}
      railTab="agent"
      pendingCount={2}
      cardEdit={null}
      submitConfirm={null}
      {...callbacks}
      />
    </RailFrame>
  ),
  size: { width: 40, height: 24 },
};

export const SubmitConfirmOpen: Story = {
  render: () => (
    <RailFrame>
      <ReviewRail
      session={fixturePlanSession()}
      authorNames={{}}
      resolvedIds={new Set()}
      railTab="review"
      pendingCount={2}
      cardEdit={null}
      submitConfirm={{
        verdict: "request_changes",
        summary: "",
        annotationCount: 2,
        blockingCount: 0,
        onInput: () => {},
        onSelectVerdict: () => {},
        onSubmit: () => {},
        onCancel: () => {},
      }}
      {...callbacks}
      />
    </RailFrame>
  ),
  expectedColors: [DARK.red],
  size: { width: 40, height: 30 },
};

export const Resolved: Story = {
  render: () => (
    <RailFrame>
      <ReviewRail
      session={fixturePlanSession({
        status: "resolved",
        verdict: { kind: "approve", summary: "", feedback: "", resolvedAt: "2026-01-01T00:00:00Z" },
      })}
      authorNames={{}}
      resolvedIds={new Set()}
      railTab="review"
      pendingCount={0}
      cardEdit={null}
      submitConfirm={null}
      {...callbacks}
      />
    </RailFrame>
  ),
  expectedColors: [DARK.green],
  size: { width: 40, height: 24 },
};
