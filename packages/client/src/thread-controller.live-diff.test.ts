/**
 * A non-diff thread (here a plan) still renders a real diff in the Changes view:
 * the controller eagerly captures the live working-tree diff, so repoChanges()
 * carries file contents and rows() derives from the patch - the same shape a
 * cueloop diff pins, just computed live.
 */

import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type Annotation, type Thread } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { createReviewController, type ShareTransport } from "./thread-controller";
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
  publish: mock(async (session: Thread) => ({
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

function planSession(id = "ses_plan", repoRoot = "/repo"): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    workspace: { repoRoot, branch: "main" },
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

function fakeClient(session: Thread): SessionClient {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionComment: unimplemented("sessionComment"),
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

    // the live per-file contents let a non-diff thread expand a folded file too
    expect(controller.canExpandFile("src/x.ts")).toBe(true);

    controller.close();
  });

  test("annotating the Changes diff stamps a file target anchored to the diff rows", async () => {
    const session = planSession();
    let sent: Annotation | undefined;
    const client = {
      ...fakeClient(session),
      sessionComment: async (_id: string, annotation: Annotation) => {
        sent = annotation;

        return { ...session, annotations: [{ ...annotation, createdAt: AT }] };
      },
    } satisfies SessionClient;
    const controller = createReviewController({
      sessionId: session.id,
      openClient: async () => client,
      shareTransport,
    });
    controller.connect();
    await tick();
    await controller.repoChanges();

    // Act - comment the added line of the working-tree diff, as the Changes surface does
    const rows = controller.rows();
    const addIndex = rows.findIndex((row) => row.kind === "add");
    const addText = rows[addIndex]!.text.replace(/\n$/, "");

    controller.annotate("comment", addIndex, 0, addText.length, "eviction?", addIndex, {
      kind: "file",
      path: "",
      rev: "worktree",
    });

    // Assert - the note carries the file target (path and rev filled from the row) and quotes the diff
    expect(sent?.target).toEqual({ kind: "file", path: "src/x.ts", rev: "worktree" });
    expect(sent?.anchor.quote).toContain("const a = 2");

    controller.close();
  });

  test("a late diff response from a previous thread never overwrites the active one", async () => {
    const sessionA = planSession("ses_A", "/repoA");
    const sessionB = planSession("ses_B", "/repoB");
    let resolveA: (diff: { patch: string; files: typeof FILES }) => void = () => {};
    const pendingA = new Promise<{ patch: string; files: typeof FILES }>((resolve) => {
      resolveA = resolve;
    });
    const diffB = {
      patch: PATCH.replace(/x\.ts/g, "y.ts"),
      files: [{ ...FILES[0]!, path: "src/y.ts" }],
    };
    const client = {
      ...fakeClient(sessionA),
      sessionList: async () => [sessionA, sessionB],
      repoDiff: async (cwd: string) => (cwd === "/repoA" ? pendingA : diffB),
    } satisfies SessionClient;

    const controller = createReviewController({
      sessionId: sessionA.id,
      openClient: async () => client,
      shareTransport,
    });
    controller.connect();
    await tick();

    // thread A's diff is still in flight when the user switches to thread B
    const inFlightA = controller.repoChanges();
    controller.open("ses_B");
    await controller.repoChanges();
    // B's diff is showing; now A's stale response lands
    resolveA({ patch: PATCH, files: FILES });
    await inFlightA;

    // the active thread keeps B's changes; A's late response is dropped
    expect(controller.rows().some((row) => row.file === "src/y.ts")).toBe(true);
    expect(controller.rows().some((row) => row.file === "src/x.ts")).toBe(false);

    controller.close();
  });
});

const STALE_PATCH = `diff --git a/src/stale.ts b/src/stale.ts
--- a/src/stale.ts
+++ b/src/stale.ts
@@ -1,1 +1,1 @@
-const s = 1;
+const s = 2;
`;

const STALE_FILES = [
  {
    path: "src/stale.ts",
    oldContents: "const s = 1;\n",
    newContents: "const s = 2;\n",
    status: "modified" as const,
  },
];

/** A `type:"diff"` thread with a captured snapshot; `meta.workbench` decides frozen vs live. */
function diffSession(meta: Thread["artifact"]["meta"], id = "ses_diff"): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "diff", content: STALE_PATCH, files: STALE_FILES, meta },
    revisions: [{ revision: 1, content: STALE_PATCH, submittedAt: AT }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: AT,
  };
}

describe("frozen vs live diff by thread kind", () => {
  test("a workbench thread renders the live working tree, not its captured snapshot", async () => {
    const session = diffSession({ workbench: true, title: "Workbench" });
    const controller = createReviewController({
      sessionId: session.id,
      openClient: async () => fakeClient(session),
      shareTransport,
    });
    controller.connect();
    await tick();

    // the live repoDiff (src/x.ts) wins over the frozen capture (src/stale.ts)
    const changes = await controller.repoChanges();

    expect(changes.map((file) => file.path)).toEqual(["src/x.ts"]);
    expect(controller.rows().some((row) => row.file === "src/x.ts")).toBe(true);
    expect(controller.rows().some((row) => row.file === "src/stale.ts")).toBe(false);

    controller.close();
  });

  test("a plain diff review pins its captured snapshot and never queries the live tree", async () => {
    const session = diffSession({});
    const repoDiff = mock(async () => ({ patch: PATCH, files: FILES }));
    const client = { ...fakeClient(session), repoDiff } satisfies SessionClient;
    const controller = createReviewController({
      sessionId: session.id,
      openClient: async () => client,
      shareTransport,
    });
    controller.connect();
    await tick();

    const changes = await controller.repoChanges();

    expect(changes.map((file) => file.path)).toEqual(["src/stale.ts"]);
    expect(controller.rows().some((row) => row.file === "src/stale.ts")).toBe(true);
    expect(repoDiff).not.toHaveBeenCalled();

    controller.close();
  });
});

const SERVED_PATCH = `diff --git a/src/served.ts b/src/served.ts
--- a/src/served.ts
+++ b/src/served.ts
@@ -1,1 +1,1 @@
-const served = 0;
+const served = 1;
`;

describe("serve mode pins the served thread to a frozen snapshot", () => {
  test("the served artifact wins over the thread's own capture and the live tree", async () => {
    const session = diffSession({ workbench: true });
    const repoDiff = mock(async () => ({ patch: PATCH, files: FILES }));
    const client = { ...fakeClient(session), repoDiff } satisfies SessionClient;
    const controller = createReviewController({
      sessionId: session.id,
      openClient: async () => client,
      shareTransport,
      servedArtifact: {
        type: "diff",
        content: SERVED_PATCH,
        files: [
          {
            path: "src/served.ts",
            oldContents: "const served = 0;\n",
            newContents: "const served = 1;\n",
            status: "modified",
          },
        ],
        meta: {},
      },
    });
    controller.connect();
    await tick();

    // the observer sees the frozen served snapshot, not the thread's stale capture nor the live tree
    expect(controller.rows().some((row) => row.file === "src/served.ts")).toBe(true);
    expect(controller.rows().some((row) => row.file === "src/stale.ts")).toBe(false);
    expect(controller.rows().some((row) => row.file === "src/x.ts")).toBe(false);
    expect(repoDiff).not.toHaveBeenCalled();

    controller.close();
  });
});
