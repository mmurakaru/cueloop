import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { buildDisplay } from "../view-plan";
import { PlanSheet } from "./PlanSheet";
import { FIXTURE_PLAN, fixtureDisplay, fixtureMarks, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "PlanSheet" };

const callbacks = { onLineActivate: () => {} };

// a working copy with the context paragraph cut, so it renders as a del block
const CUT_WORKING = FIXTURE_PLAN.replace("The daemon persists sessions to disk atomically.\n", "");

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
  expectedColors: [DARK.markCommentBackground, DARK.cursorBackground],
  size: { width: 90, height: 28 },
};

export const SpanSelection: Story = {
  render: () => (
    <PlanSheet
      session={fixturePlanSession({ annotations: [] })}
      display={fixtureDisplay()}
      marks={new Map()}
      cursor={2}
      activeSpan={{ displayIndex: 2, start: 0, end: 10 }}
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
      activeSpan={{ displayIndex: 2, start: 0, end: 10 }}
      compose={{
        kind: "comment",
        displayIndex: 2,
        quote: "The daemon",
        draft: { text: "Which daemon?", onInput: () => {}, onSave: () => {}, onCancel: () => {} },
      }}
      editOrphanCount={0}
      {...callbacks}
    />
  ),
  size: { width: 90, height: 30 },
};

/** A cut block renders struck-through and grayed inline - no red, no [cut] tag. */
export const WithCutBlock: Story = {
  render: () => (
    <PlanSheet
      session={fixturePlanSession()}
      display={buildDisplay(FIXTURE_PLAN, CUT_WORKING)}
      marks={new Map()}
      cursor={0}
      activeSpan={null}
      compose={null}
      editOrphanCount={0}
      {...callbacks}
    />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 90, height: 28 },
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
