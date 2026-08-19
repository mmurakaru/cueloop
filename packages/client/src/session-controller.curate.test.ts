import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type DiffFileContents, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { createReviewController } from "./session-controller";

const PATCH = `diff --git a/src/store.ts b/src/store.ts
index 111..222 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,4 +1,4 @@
 export class Store {
-  private items = [];
+  private items = new Map();
 }
`;

const FILES: DiffFileContents[] = [
  {
    path: "src/store.ts",
    oldContents: "export class Store {\n  private items = [];\n}\n",
    newContents: "export class Store {\n  private items = new Map();\n}\n",
    status: "modified",
  },
];

function diffSession(files?: DiffFileContents[]): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_diff",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "diff", content: PATCH, meta: {}, files },
    revisions: [{ revision: 1, content: PATCH, submittedAt: "2026-01-01T00:00:00.000Z" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A fake client that records the working copy the controller writes. */
function fakeClient(session: ReviewSession, sink: { workingCopy?: string }): SessionClient {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionSetWorkingCopy: mock(async (_id: string, content: string | undefined) => {
      sink.workingCopy = content;
      return { ...session, workingCopy: content };
    }),
    close: () => {},
  } as unknown as SessionClient;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connected(session: ReviewSession) {
  const sink: { workingCopy?: string } = {};
  const client = fakeClient(session, sink);
  const controller = createReviewController({
    sessionId: session.id,
    openClient: async () => client,
  });
  controller.connect();
  await tick();
  return { controller, client, sink };
}

// rows for PATCH: file(0), hunk(1), ctx(2), del(3), add(4), ctx(5)
describe("diff hunk curation", () => {
  test("rejecting the only change writes an empty curated working copy", async () => {
    // Arrange
    const { controller, sink } = await connected(diffSession(FILES));

    // Act - reject the change on the added line
    controller.toggleRejectChange(4);
    await tick();

    // Assert
    expect(controller.getSnapshot().status).toContain("change rejected");
    expect(sink.workingCopy).toBe("");
  });

  test("both the deletion and addition rows of the change dim", async () => {
    // Arrange
    const { controller } = await connected(diffSession(FILES));

    // Act
    controller.toggleRejectChange(4);
    await tick();

    // Assert - the change spans the del row and the add row
    expect([...controller.rejectedRows()].sort((a, b) => a - b)).toEqual([3, 4]);
  });

  test("toggling the same change twice restores the full diff", async () => {
    // Arrange
    const { controller, sink } = await connected(diffSession(FILES));

    // Act - reject then restore
    controller.toggleRejectChange(4);
    await tick();
    controller.toggleRejectChange(4);
    await tick();

    // Assert - no decisions left, so the working copy reverts to undefined
    expect(controller.getSnapshot().status).toContain("change restored");
    expect(sink.workingCopy).toBeUndefined();
    expect(controller.rejectedRows().size).toBe(0);
  });

  test("whole-hunk reject drops the hunk from the working copy", async () => {
    // Arrange
    const { controller, sink } = await connected(diffSession(FILES));

    // Act - reject the whole hunk from any of its rows
    controller.toggleRejectHunk(3);
    await tick();

    // Assert - the single hunk is the whole diff, so nothing remains
    expect(controller.getSnapshot().status).toContain("hunk rejected");
    expect(sink.workingCopy).toBe("");
  });

  test("curation is disabled without full file contents", async () => {
    // Arrange - a legacy diff with no artifact.files
    const { controller, sink } = await connected(diffSession(undefined));

    // Act
    controller.toggleRejectChange(4);
    await tick();

    // Assert
    expect(controller.getSnapshot().status).toContain("hunk curation needs full file contents");
    expect(sink.workingCopy).toBeUndefined();
  });
});
