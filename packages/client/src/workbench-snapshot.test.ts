/** Sharing/serving a workbench thread freezes its live working-tree diff into the artifact so a remote
 * reviewer, who cannot see the owner's tree, reads a stable snapshot; any other thread passes through. */

import { describe, expect, mock, test } from "bun:test";
import { historyFromLinear, viewFollowing, type Thread } from "@cueloop/schema";
import { snapshotWorkbench } from "./workbench-snapshot";

const AT = "2026-01-01T00:00:00.000Z";

const STALE_FILES = [
  { path: "src/a.ts", oldContents: "a\n", newContents: "b\n", status: "modified" as const },
];
const LIVE = {
  patch: "FRESH PATCH",
  files: [
    { path: "src/a.ts", oldContents: "a\n", newContents: "c\n", status: "modified" as const },
  ],
};

function diffThread(meta: Thread["artifact"]["meta"]): Thread {
  return {
    schemaVersion: "1",
    id: "ses_wb",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "diff", content: "STALE PATCH", files: STALE_FILES, meta },
    revisions: [{ revision: 1, content: "STALE PATCH", submittedAt: AT }],
    annotations: [
      {
        id: "n1",
        kind: "comment",
        anchor: { quote: "b", prefix: "", suffix: "" },
        body: "why?",
        createdAt: AT,
      },
    ],
    verdict: null,
    status: "pending",
    createdAt: AT,
  };
}

describe("snapshotWorkbench", () => {
  test("freezes a workbench thread's live diff and drops the workbench flag", async () => {
    const frozen = await snapshotWorkbench(
      diffThread({ workbench: true, title: "Workbench" }),
      async () => LIVE,
    );

    // the live diff is pinned into the artifact
    expect(frozen.artifact.content).toBe("FRESH PATCH");
    expect(frozen.artifact.files).toEqual(LIVE.files);
    // the snapshot marker pins the render; the workbench marker stays so file-targeted feedback still paints
    expect(frozen.artifact.meta.snapshot).toBe(true);
    expect(frozen.artifact.meta.workbench).toBe(true);
    expect(frozen.artifact.meta.title).toBe("Workbench");
    // the thread is otherwise intact - same id, workspace, and annotations
    expect(frozen.id).toBe("ses_wb");
    expect(frozen.annotations).toHaveLength(1);
  });

  test("recaptures history so the share path rebuilds the fresh content, not the stale head", async () => {
    // a workbench thread carries branch history whose head is the creation-time capture
    const base = diffThread({ workbench: true });
    const withHistory: Thread = { ...base, history: historyFromLinear(base) };

    const frozen = await snapshotWorkbench(withHistory, async () => LIVE);

    // viewFollowing (the share path) rebuilds content from history - it must yield the fresh patch
    expect(viewFollowing(frozen).artifact.content).toBe("FRESH PATCH");
  });

  test("passes a plain diff review through untouched and never queries the tree", async () => {
    const session = diffThread({ title: "PR #7" });
    const repoDiff = mock(async () => LIVE);

    const result = await snapshotWorkbench(session, repoDiff);

    expect(result).toBe(session);
    expect(repoDiff).not.toHaveBeenCalled();
  });
});
