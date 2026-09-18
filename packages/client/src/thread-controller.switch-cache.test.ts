import { describe, expect, mock, test } from "bun:test";
import {
  SCHEMA_VERSION,
  type DiffFileContents,
  type HunkRejection,
  type Thread,
} from "@cueloop/schema";
import { curateDiff } from "@cueloop/daemon/curate";
import type { SessionClient } from "@cueloop/daemon/client";
import { createReviewController } from "./thread-controller";

const PATCH_A = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 export class A {
-  value = 1;
+  value = 2;
 }
`;

const PATCH_B = `diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,3 @@
 export class B {
-  flag = false;
+  flag = true;
 }
`;

function diffSession(id: string, patch: string, files: DiffFileContents[]): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "diff", content: patch, meta: { title: id }, files },
    revisions: [{ revision: 1, content: patch, submittedAt: "2026-01-01T00:00:00.000Z" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const FILES_A: DiffFileContents[] = [
  {
    path: "src/a.ts",
    oldContents: "export class A {\n  value = 1;\n}\n",
    newContents: "export class A {\n  value = 2;\n}\n",
    status: "modified",
  },
];
const FILES_B: DiffFileContents[] = [
  {
    path: "src/b.ts",
    oldContents: "export class B {\n  flag = false;\n}\n",
    newContents: "export class B {\n  flag = true;\n}\n",
    status: "modified",
  },
];

const unimplemented = (member: string) => () =>
  Promise.reject(new Error(`fakeClient does not implement ${member}`));

/** A fake client over a fixed set of sessions, so open(id) can switch between them from the inbox. */
function fakeClient(sessions: Thread[]): SessionClient {
  const byId = new Map(sessions.map((session) => [session.id, session]));

  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async (id: string) => byId.get(id)!,
    sessionList: async () => [...byId.values()],
    sessionCurate: mock(async (id: string, rejections: HunkRejection[]) => {
      const session = byId.get(id)!;
      const content = rejections.length
        ? curateDiff(session.artifact.files!, rejections)
        : undefined;
      const next = {
        ...session,
        workingCopy: content,
        curation: rejections.length ? rejections : undefined,
      };

      byId.set(id, next);

      return next;
    }),
    sessionComment: unimplemented("sessionComment"),
    sessionAnnotate: unimplemented("sessionAnnotate"),
    sessionRemoveAnnotation: unimplemented("sessionRemoveAnnotation"),
    sessionSetWorkingCopy: unimplemented("sessionSetWorkingCopy"),
    sessionCutBlock: unimplemented("sessionCutBlock"),
    sessionRestoreBlock: unimplemented("sessionRestoreBlock"),
    sessionSetAccess: unimplemented("sessionSetAccess"),
    sessionNavigate: unimplemented("sessionNavigate"),
    sessionBranch: unimplemented("sessionBranch"),
    sessionSwitch: unimplemented("sessionSwitch"),
    sessionLabel: unimplemented("sessionLabel"),
    sessionFork: unimplemented("sessionFork"),
    sessionSetViewed: unimplemented("sessionSetViewed"),
    sessionSetTitle: unimplemented("sessionSetTitle"),
    sessionSetShareId: unimplemented("sessionSetShareId"),
    sessionMergeShared: unimplemented("sessionMergeShared"),
    sessionDelete: unimplemented("sessionDelete"),
    sessionSetSelfName: unimplemented("sessionSetSelfName"),
    sessionResolve: unimplemented("sessionResolve"),
    close: () => {},
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// rows for each single-change patch: file(0), hunk(1), ctx(2), del(3), add(4), ctx(5)
describe("switching threads keeps the cached projection curatable", () => {
  test("curation still works after switching away and back to a diff thread", async () => {
    // Arrange - two diff threads in one inbox
    const controller = createReviewController({
      sessionId: "ses_a",
      openClient: async () =>
        fakeClient([
          diffSession("ses_a", PATCH_A, FILES_A),
          diffSession("ses_b", PATCH_B, FILES_B),
        ]),
    });

    controller.connect();
    await tick();

    // Act - visit B, then return to A (A's projection now comes from the per-thread cache)
    controller.open("ses_b");
    await tick();
    controller.open("ses_a");
    await tick();

    // Assert - the returned thread's file model parses lazily and curation lands
    controller.toggleRejectChange(4);
    await tick();

    expect(controller.getSnapshot().status).toContain("change rejected");
    expect(controller.getSnapshot().session?.workingCopy).toBe("");
  });
});
