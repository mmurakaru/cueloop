/** Shared fixture data for the stories catalog: one plan session, one diff. */

import type { Annotation, ReviewSession } from "@cueloop/schema";
import { buildDisplay, marksByDisplay } from "../view-plan";
import { diffRows } from "../view-diff";

export const FIXTURE_PLAN = `# Migration Plan

## Context

The daemon persists sessions to disk atomically.

## Steps

- move the store
- add recovery

\`\`\`ts
export function persist(session: Session): void {
  // one JSON document per session
  writeAtomically(pathFor(session.id), serialize(session));
}
\`\`\`
`;

export const FIXTURE_PATCH = `diff --git a/src/store.ts b/src/store.ts
index 111..222 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,4 +1,4 @@
 export class Store {
-  private items = [];
+  private items = new Map();
 }
`;

export const FIXTURE_ANNOTATIONS: Annotation[] = [
  {
    id: "a_story_1",
    kind: "comment",
    anchor: { quote: "persists sessions", prefix: "The daemon ", suffix: " to disk" },
    body: "Which daemon owns this?",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "a_story_2",
    kind: "suggestion",
    anchor: { quote: "move the store", prefix: "", suffix: "" },
    body: "move the store behind one interface",
    createdAt: "2026-01-01T00:00:01Z",
  },
];

export function fixturePlanSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    schemaVersion: "1",
    id: "s_story_plan",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "plan",
      content: FIXTURE_PLAN,
      meta: { title: "Migration Plan", agent: "agent/worker-3" },
    },
    revisions: [{ revision: 1, content: FIXTURE_PLAN, submittedAt: "2026-01-01T00:00:00Z" }],
    annotations: FIXTURE_ANNOTATIONS,
    status: "pending",
    ...overrides,
  } as ReviewSession;
}

export function fixtureDiffSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    schemaVersion: "1",
    id: "s_story_diff",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "diff",
      content: FIXTURE_PATCH,
      meta: { title: "working tree", agent: "agent/worker-3" },
    },
    revisions: [{ revision: 1, content: FIXTURE_PATCH, submittedAt: "2026-01-01T00:00:00Z" }],
    annotations: [],
    status: "pending",
    ...overrides,
  } as ReviewSession;
}

export function fixtureDisplay() {
  return buildDisplay(FIXTURE_PLAN);
}

export function fixtureMarks() {
  return marksByDisplay(FIXTURE_ANNOTATIONS, fixtureDisplay());
}

export function fixtureDiffRows() {
  return diffRows(FIXTURE_PATCH);
}
