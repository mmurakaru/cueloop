import { expect, test } from "bun:test";
import { DaemonCore } from "./api";
import { MemoryThreadStore } from "./store";
import { prepareSyncThreadImport } from "./sync-thread-protocol";

test("Thread imports reject invalid database timestamps and null characters before fencing local authority", async () => {
  const core = new DaemonCore("/nonexistent-cueloop-protocol-test", new MemoryThreadStore());

  try {
    const thread = core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "Original plan", meta: {} },
    });
    const workspaceIdentifier = "019a691a-c6ae-7000-8000-000000000001";

    await expect(
      prepareSyncThreadImport({
        workspaceIdentifier,
        thread: { ...thread, createdAt: "invalid time" },
      }),
    ).rejects.toThrow("creation time");
    await expect(
      prepareSyncThreadImport({
        workspaceIdentifier,
        thread: { ...thread, workingCopy: "bad\0text" },
      }),
    ).rejects.toThrow("Unicode");
    expect(core.sessionGet(thread.id).artifact.content).toBe("Original plan");
  } finally {
    core.dispose();
  }
});
