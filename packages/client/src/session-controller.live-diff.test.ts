/**
 * A non-diff thread (here a plan) still renders a real diff in the Changes view:
 * the controller eagerly captures the live working-tree diff, so repoChanges()
 * carries file contents and rows() derives from the patch - the same shape a
 * cueloop diff pins, just computed live.
 */

import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { createReviewController, type ShareTransport } from "./session-controller";
import { mergeFromShare } from "./share";

const AT = "2026-01-01T00:00:00.000Z";

const PATCH = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;
`;

const FILES = [
  {
    path: "src/x.ts",
    oldContents: "const a = 1;\n",
    newContents: "const a = 2;\n",
    status: "modified" as const,
  },
];

const shareTransport: ShareTransport = {
  publish: mock(async (session: ReviewSession) => ({
    line: `ssh p_${session.id}@cueloop.dev`,
    copied: true,
  })),
  pull: mock(async () => planSession()),
  push: mock(async () => {}),
  watch: () => () => {},
  parseShareId: (line) => line.match(/^ssh (\S+)@/)?.[1],
  collaboratorAnnotations: (session) => session.annotations.filter((entry) => entry.author),
  mergeFromShare,
};

function planSession(): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_plan",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n", meta: {} },
    revisions: [{ revision: 1, content: "# Plan\n", submittedAt: AT }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: AT,
  };
}

const unimplemented = (member: string) => () =>
  Promise.reject(new Error(`fakeClient does not implement ${member}`));

function fakeClient(session: ReviewSession): SessionClient {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionAnnotate: unimplemented("sessionAnnotate"),
    sessionRemoveAnnotation: unimplemented("sessionRemoveAnnotation"),
    sessionSetWorkingCopy: unimplemented("sessionSetWorkingCopy"),
    sessionCutBlock: unimplemented("sessionCutBlock"),
    sessionRestoreBlock: unimplemented("sessionRestoreBlock"),
    sessionCurate: unimplemented("sessionCurate"),
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
    repoDiff: async () => ({ patch: PATCH, files: FILES }),
    close: () => {},
  } satisfies SessionClient;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("live working-tree diff for a non-diff thread", () => {
  test("repoChanges carries file contents and rows derive from the patch", async () => {
    const session = planSession();
    const controller = createReviewController({
      sessionId: session.id,
      openClient: async () => fakeClient(session),
      shareTransport,
    });
    controller.connect();
    await tick();

    // Act - the Changes navigator loads
    const changes = await controller.repoChanges();

    // Assert - real per-file contents, not empty stubs
    expect(changes.map((file) => file.path)).toEqual(["src/x.ts"]);
    expect(changes[0]!.newContents).toBe("const a = 2;\n");

    // and the diff rows derive from the live patch, so an opened file tab shows a diff
    expect(controller.rows().some((row) => row.file === "src/x.ts")).toBe(true);

    controller.close();
  });
});
