import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ReviewRail } from "./ReviewRail";
import { FIXTURE_ANNOTATIONS, fixtureDiffSession, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "ReviewRail" };

const callbacks = {
  curationItems: [],
  onTabChange: () => {},
  onSelectCard: () => {},
  onActivateCard: () => {},
  onSelectCuration: () => {},
  onUndoCuration: () => {},
  onSubmitRequest: () => {},
  onLaunchHarness: () => {},
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
  expectedColors: [DARK.accent],
  size: { width: 40, height: 24 },
};

export const MixedOwnershipStack: Story = {
  render: () => (
    <RailFrame>
      <ReviewRail
        session={fixturePlanSession({
          participants: [{ id: "SHA256:collab1", provider: "ssh", name: "Priya" }],
          annotations: [
            {
              id: "own_note",
              kind: "comment",
              anchor: { quote: "persists sessions", prefix: "The daemon ", suffix: " to disk" },
              body: "Which daemon owns this?",
              createdAt: "2026-01-01T00:00:00Z",
            },
            {
              id: "collab_note",
              kind: "comment",
              anchor: { quote: "move the store", prefix: "", suffix: "" },
              body: "move it behind one interface",
              author: "SHA256:collab1",
              createdAt: "2026-01-01T00:00:01Z",
            },
          ],
        })}
        authorNames={{}}
        selectedId="own_note"
        resolvedIds={new Set(["own_note", "collab_note"])}
        railTab="review"
        pendingCount={2}
        cardEdit={null}
        submitConfirm={null}
        {...callbacks}
      />
    </RailFrame>
  ),
  // every annotation border is accent now
  expectedColors: [DARK.accent],
  size: { width: 40, height: 24 },
};

export const Removals: Story = {
  render: () => (
    <RailFrame>
      <ReviewRail
        session={fixtureDiffSession()}
        authorNames={{}}
        resolvedIds={null}
        railTab="review"
        pendingCount={0}
        cardEdit={null}
        submitConfirm={null}
        {...callbacks}
        curationItems={[
          {
            id: "diff:src/store.ts#0#1",
            source: "diff",
            preview: ["-   private items = [];", "+   private items = new Map();"],
            revealIndex: 3,
          },
          {
            id: "diff:src/store.ts#1#hunk",
            source: "diff",
            preview: ["-   return null;", "+   return fallback();", "+   log(fallback);"],
            revealIndex: 9,
          },
        ]}
        selectedCurationId="diff:src/store.ts#0#1"
      />
    </RailFrame>
  ),
  expectedColors: [DARK.red],
  size: { width: 40, height: 24 },
};

/** A plan cut and an annotation interleave in one line-ordered stack. */
export const InterleavedStack: Story = {
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
        curationItems={[
          {
            id: "plan:6-6",
            source: "plan",
            preview: ["- add recovery"],
            revealIndex: 1,
          },
        ]}
        annotationPositions={new Map([[FIXTURE_ANNOTATIONS[0]!.id, 5]])}
      />
    </RailFrame>
  ),
  expectedColors: [DARK.accent],
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
          verdict: {
            kind: "approve",
            summary: "",
            feedback: "",
            resolvedAt: "2026-01-01T00:00:00Z",
          },
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
