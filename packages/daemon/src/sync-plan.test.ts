import { expect, test } from "bun:test";
import { makeAnchor, parseBlocks } from "@cueloop/schema";
import { toSyncPlanHistoryEntry, orphanedSyncPlanAnnotations } from "./sync-plan";
import { SessionEntrySchema } from "./validate";
import * as v from "valibot";

test("accepted text revisions retain operation identity, parent, and verified author in review history", () => {
  const entry = toSyncPlanHistoryEntry({
    identifier: "019a6650-0000-7000-8000-000000000002",
    parentIdentifier: "019a6650-0000-7000-8000-000000000001",
    actorIdentifier: "alice",
    revision: 1,
    content: "Accepted plan",
    acceptedAt: 1700000000000,
  });

  expect(v.parse(SessionEntrySchema, entry)).toEqual({
    id: "019a6650-0000-7000-8000-000000000002",
    parentId: "019a6650-0000-7000-8000-000000000001",
    type: "revision",
    by: "reviewer",
    author: "alice",
    content: "Accepted plan",
    createdAt: "2023-11-14T22:13:20.000Z",
  });
});

test("shared plan annotations resolve by quote or remain explicitly orphaned", () => {
  const content = "# Plan\n\nKeep this paragraph\n\nRemove this sentence";
  const blocks = parseBlocks(content);
  const annotations = [
    {
      id: "keep",
      kind: "comment" as const,
      anchor: makeAnchor(blocks, 1, 0, 4),
      body: "Keep",
      createdAt: "2023-11-14T22:13:20.000Z",
    },
    {
      id: "removed",
      kind: "comment" as const,
      anchor: makeAnchor(blocks, 2, 0, 20),
      body: "Discuss",
      createdAt: "2023-11-14T22:13:20.000Z",
    },
  ];

  expect(
    orphanedSyncPlanAnnotations({
      annotations,
      content: "# Plan\n\nKeep this paragraph after an edit",
    }),
  ).toEqual(["removed"]);
  expect(annotations.map((annotation) => annotation.id)).toEqual(["keep", "removed"]);
});
