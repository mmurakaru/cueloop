import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore } from "./api";

test("send message operation receipts survive restart and reject changed payloads", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-operation-"));
  let core = new DaemonCore(home);

  try {
    const thread = core.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Review this", meta: {} },
    });
    const accepted = core.sessionSendMessage(thread.id, "comment", "First", undefined, "op-first");
    const message = structuredClone(accepted.message);
    core.sessionSendMessage(thread.id, "comment", "Second", undefined, "op-second");
    core.dispose();
    core = new DaemonCore(home);
    const replay = core.sessionSendMessage(thread.id, "comment", "First", undefined, "op-first");

    expect(replay.message).toEqual(message);
    expect(
      core.sessionGet(thread.id).history?.entries.filter((entry) => entry.type === "message"),
    ).toHaveLength(2);
    expect(() =>
      core.sessionSendMessage(thread.id, "comment", "Changed", undefined, "op-first"),
    ).toThrow("Operation payload conflict");
  } finally {
    core.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("receipt capacity never evicts accepted IDs and share blobs omit private receipts", async () => {
  const { packSessionBlob, unpackSessionBlob } = await import("./share-blob");
  const home = mkdtempSync(join(tmpdir(), "cueloop-operation-capacity-"));
  const core = new DaemonCore(home);

  try {
    const thread = core.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Review", meta: {} },
    });
    const first = structuredClone(
      core.sessionSendMessage(thread.id, "comment", "First", undefined, "first").message,
    );
    for (let index = 1; index < 128; index++)
      core.sessionSendMessage(
        thread.id,
        "comment",
        `Message ${index}`,
        undefined,
        `operation-${index}`,
      );
    expect(() =>
      core.sessionSendMessage(thread.id, "comment", "Overflow", undefined, "overflow"),
    ).toThrow("Operation receipt capacity");
    expect(
      core.sessionSendMessage(thread.id, "comment", "First", undefined, "first").message,
    ).toEqual(first);
    expect(
      unpackSessionBlob(packSessionBlob(core.sessionGet(thread.id))).messageOperations,
    ).toBeUndefined();
  } finally {
    core.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("failed receipt persistence never acknowledges an in-memory-only review message", async () => {
  const { mkdirSync, readdirSync } = await import("node:fs");
  const { threadsDir } = await import("./paths");
  const home = mkdtempSync(join(tmpdir(), "cueloop-operation-disk-failure-"));
  const core = new DaemonCore(home);

  try {
    const thread = core.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Review", meta: {} },
    });
    const bucket = readdirSync(threadsDir(home))[0]!;
    const tempPath = join(threadsDir(home), bucket, `${thread.id}.jsonl.tmp`);
    mkdirSync(tempPath);
    expect(() =>
      core.sessionSendMessage(thread.id, "comment", "Once", undefined, "persist-once"),
    ).toThrow();
    expect(core.sessionGet(thread.id).messageOperations).toBeUndefined();
    expect(core.sessionGet(thread.id).message).toBeNull();
    rmSync(tempPath, { recursive: true });
    const accepted = core.sessionSendMessage(
      thread.id,
      "comment",
      "Once",
      undefined,
      "persist-once",
    );
    expect(accepted.messageOperations).toHaveLength(1);
    expect(
      core.sessionSendMessage(thread.id, "comment", "Once", undefined, "persist-once").message,
    ).toEqual(accepted.message);
  } finally {
    core.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});
