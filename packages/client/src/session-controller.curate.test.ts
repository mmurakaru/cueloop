import { describe, expect, mock, test } from "bun:test";
import {
  cutBlock,
  parseBlocks,
  restoreBlock,
  SCHEMA_VERSION,
  type DiffFileContents,
  type HunkRejection,
  type ReviewSession,
} from "@cueloop/schema";
import { curateDiff } from "@cueloop/daemon/curate";
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

interface WorkingCopySink {
  workingCopy?: string;
}

const unimplemented = (member: string) => () =>
  Promise.reject(new Error(`fakeClient does not implement ${member}`));

/** A fake client that records the working copy the controller writes. */
function fakeClient(initial: ReviewSession, sink: WorkingCopySink): SessionClient {
  let session = initial;

  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionAnnotate: unimplemented("sessionAnnotate"),
    sessionRemoveAnnotation: unimplemented("sessionRemoveAnnotation"),
    sessionSetWorkingCopy: mock(async (_id: string, content: string | undefined) => {
      sink.workingCopy = content;

      return { ...session, workingCopy: content };
    }),
    // the daemon's block primitives, stood in for with the same pure helpers it uses
    sessionCutBlock: mock(async (_id: string, blockIndex: number) => {
      const working = session.workingCopy ?? session.artifact.content;
      const content = cutBlock(working, parseBlocks(working)[blockIndex]!);

      sink.workingCopy = content;
      session = { ...session, workingCopy: content };

      return session;
    }),
    sessionRestoreBlock: mock(async (_id: string, baseBlockIndex: number, line?: number) => {
      const base = session.artifact.content;
      const working = session.workingCopy ?? base;
      const content = restoreBlock(
        base,
        working,
        parseBlocks(base)[baseBlockIndex]!,
        line ?? working.split("\n").length,
      );

      sink.workingCopy = content;
      session = { ...session, workingCopy: content };
      if (content === undefined) delete session.workingCopy;

      return session;
    }),
    // the daemon's curation, stood in for: the record carries the decisions and the patch they leave
    sessionCurate: mock(async (_id: string, rejections: HunkRejection[]) => {
      const content = rejections.length
        ? curateDiff(session.artifact.files!, rejections)
        : undefined;

      sink.workingCopy = content;
      session = { ...session, workingCopy: content };
      if (rejections.length) session.curation = rejections;
      else delete session.curation;

      return session;
    }),
    sessionSetViewed: unimplemented("sessionSetViewed"),
    sessionSetShareId: unimplemented("sessionSetShareId"),
    sessionMergeShared: unimplemented("sessionMergeShared"),
    sessionDelete: unimplemented("sessionDelete"),
    sessionSetSelfName: unimplemented("sessionSetSelfName"),
    sessionResolve: unimplemented("sessionResolve"),
    close: () => {},
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connected(session: ReviewSession) {
  const sink: WorkingCopySink = {};
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

  test("a rejected change becomes a removal card with a source, id, and preview", async () => {
    // Arrange
    const { controller } = await connected(diffSession(FILES));

    // Act
    controller.toggleRejectChange(4);
    await tick();

    // Assert - one item: diff source, revealing the change's row, both lines previewed
    const items = controller.curationItems();

    expect(items.length).toBe(1);
    expect(items[0]!.source).toBe("diff");
    expect(items[0]!.id).toBe("diff:src/store.ts#0#1");
    expect(items[0]!.revealIndex).toBe(3);
    expect(items[0]!.preview).toEqual([
      "-   private items = [];",
      "+   private items = new Map();",
    ]);
  });

  test("a rejected hunk becomes a removal card with the whole-hunk id", async () => {
    // Arrange
    const { controller } = await connected(diffSession(FILES));

    // Act
    controller.toggleRejectHunk(3);
    await tick();

    // Assert - the whole hunk, id diff:path#hunk#hunk
    const items = controller.curationItems();

    expect(items.length).toBe(1);
    expect(items[0]!.source).toBe("diff");
    expect(items[0]!.id).toBe("diff:src/store.ts#0#hunk");
  });

  test("restoreCuration drops the diff removal and reverts the working copy", async () => {
    // Arrange - one change rejected
    const { controller, sink } = await connected(diffSession(FILES));

    controller.toggleRejectChange(4);
    await tick();
    const [item] = controller.curationItems();

    // Act
    controller.restoreCuration(item!.id);
    await tick();

    // Assert - the list empties and the working copy reverts to the full diff
    expect(controller.getSnapshot().status).toContain("removal restored");
    expect(controller.curationItems().length).toBe(0);
    expect(sink.workingCopy).toBeUndefined();
    expect(controller.rejectedRows().size).toBe(0);
  });

  test("restoreCuration ignores an unknown id", async () => {
    // Arrange - one change rejected
    const { controller } = await connected(diffSession(FILES));

    controller.toggleRejectChange(4);
    await tick();

    // Act
    controller.restoreCuration("diff:nope#0#0");
    await tick();

    // Assert - the item stays
    expect(controller.curationItems().length).toBe(1);
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

const PLAN_CONTENT = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
// the working copy with the "Second paragraph." block cut out
const PLAN_CUT = "# Title\n\nFirst paragraph.\n";

function planSession(workingCopy?: string): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_plan",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN_CONTENT, meta: {} },
    revisions: [{ revision: 1, content: PLAN_CONTENT, submittedAt: "2026-01-01T00:00:00.000Z" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    workingCopy,
  };
}

describe("plan cut removals", () => {
  test("a cut block becomes a plan removal card previewing its content", async () => {
    // Arrange - a plan whose working copy dropped the second paragraph
    const { controller } = await connected(planSession(PLAN_CUT));

    // Act
    const items = controller.curationItems();

    // Assert - one plan-source removal, keyed on the base line range, content previewed
    expect(items.length).toBe(1);
    expect(items[0]!.source).toBe("plan");
    expect(items[0]!.id).toBe("plan:4-4");
    expect(items[0]!.preview).toEqual(["Second paragraph."]);
  });

  test("restoreCuration re-inserts the cut block and returns to pristine", async () => {
    // Arrange
    const { controller, sink } = await connected(planSession(PLAN_CUT));
    const [item] = controller.curationItems();

    // Act
    controller.restoreCuration(item!.id);
    await tick();

    // Assert - restoring the only cut round-trips to the submitted revision
    expect(controller.getSnapshot().status).toContain("removal restored");
    expect(sink.workingCopy).toBeUndefined();
  });
});
