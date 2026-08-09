import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PlanSheet } from "./PlanSheet";
import { fixtureDisplay, fixtureMarks, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "PlanSheet" };

const callbacks = { onLineActivate: () => {}, onEditRequest: () => {} };

export const AnnotatedPlan: Story = {
  render: () => (
    <PlanSheet
      session={fixturePlanSession()}
      display={fixtureDisplay()}
      marks={fixtureMarks()}
      cursor={2}
      activeSpan={null}
      compose={null}
      editOrphanCount={0}
      {...callbacks}
    />
  ),
  expectedColors: [DARK.markCommentBg, DARK.markSuggestionBg, DARK.cursorBg],
  size: { width: 90, height: 28 },
};

export const SpanSelection: Story = {
  render: () => (
    <PlanSheet
      session={fixturePlanSession({ annotations: [] })}
      display={fixtureDisplay()}
      marks={new Map()}
      cursor={2}
      activeSpan={{ dispIdx: 2, start: 0, end: 10 }}
      compose={null}
      editOrphanCount={0}
      {...callbacks}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 90, height: 28 },
};

export const InlineCompose: Story = {
  render: () => (
    <PlanSheet
      session={fixturePlanSession({ annotations: [] })}
      display={fixtureDisplay()}
      marks={new Map()}
      cursor={2}
      activeSpan={{ dispIdx: 2, start: 0, end: 10 }}
      compose={{
        kind: "comment",
        dispIdx: 2,
        quote: "The daemon",
        draft: { text: "Which daemon?", onInput: () => {}, onSave: () => {}, onCancel: () => {} },
      }}
      editOrphanCount={0}
      {...callbacks}
    />
  ),
  size: { width: 90, height: 30 },
};

export const OrphanBanner: Story = {
  render: () => (
    <PlanSheet
      session={fixturePlanSession()}
      display={fixtureDisplay()}
      marks={new Map()}
      cursor={0}
      activeSpan={null}
      compose={null}
      editOrphanCount={1}
      {...callbacks}
    />
  ),
  expectedColors: [DARK.red],
  size: { width: 90, height: 28 },
};
