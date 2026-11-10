import { expect, test } from "bun:test";
import { SyncThreadOperationQueue } from "./sync-thread-operation-queue";

test("handoff waits for the same Thread's draft writes while another Thread stays independent", async () => {
  const queue = new SyncThreadOperationQueue();
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const committed: string[] = [];
  const draft = queue.run("first-thread", async () => {
    writing.resolve();
    await release.promise;
    committed.push("draft saved");
  });

  await writing.promise;
  const handoff = queue.run("first-thread", async () => {
    expect(committed).toContain("draft saved");
    committed.push("route changed");
  });

  await queue.run("second-thread", async () => {
    committed.push("other Thread changed");
  });
  expect(committed).toEqual(["other Thread changed"]);
  release.resolve();
  await Promise.all([draft, handoff, queue.drain()]);
  expect(committed).toEqual(["other Thread changed", "draft saved", "route changed"]);
});

test("a rejected draft operation releases its Thread for recovery", async () => {
  const queue = new SyncThreadOperationQueue();
  const rejected = queue.run("thread", async () => {
    throw new Error("Source authority is fenced");
  });
  const recovery = queue.run("thread", async () => "retained input moved");

  await expect(rejected).rejects.toThrow("fenced");
  expect(await recovery).toBe("retained input moved");
  await queue.drain();
});
