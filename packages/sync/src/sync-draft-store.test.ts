import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncSqliteStorage } from "./sync-sqlite-storage.ts";
import { createSyncDraftStore } from "./sync-draft-store.ts";
import { defineSyncOperation } from "./sync-operation.ts";
import * as v from "valibot";

test("a draft survives restart and remains separate from another user or authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-drafts-"));
  const storage = createSyncSqliteStorage({ directory });
  const options = {
    storage,
    authorityIdentifier: "https://sync.example.test",
    userIdentifier: "alice",
  };
  const original = createSyncDraftStore(options);

  try {
    const saved = await original.save({ content: { body: "Keep this unsent comment" } });

    await original.close();
    const recovered = createSyncDraftStore(options);
    const otherUser = createSyncDraftStore({ ...options, userIdentifier: "bob" });
    const otherAuthority = createSyncDraftStore({
      ...options,
      authorityIdentifier: "https://other.example.test",
    });

    try {
      expect(await recovered.list()).toEqual([saved]);
      expect(saved.status).toBe("draft");
      expect(await otherUser.list()).toEqual([]);
      expect(await otherAuthority.list()).toEqual([]);
    } finally {
      await recovered.close();
      await otherUser.close();
      await otherAuthority.close();
    }
  } finally {
    await original.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a full draft queue rejects new input without losing saved drafts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-draft-budget-"));
  const store = createSyncDraftStore({
    storage: createSyncSqliteStorage({ directory }),
    authorityIdentifier: "https://sync.example.test",
    userIdentifier: "alice",
    maximumItems: 1,
  });

  try {
    const original = await store.save({ content: "Keep the first draft" });

    await expect(store.save({ content: "A second draft" })).rejects.toThrow();
    expect(await store.list()).toEqual([original]);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a rejected operation keeps its saved identity and recoverable user input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-rejected-draft-"));
  const store = createSyncDraftStore({
    storage: createSyncSqliteStorage({ directory }),
    authorityIdentifier: "https://sync.example.test",
    userIdentifier: "alice",
  });

  try {
    const saved = await store.save({ content: { body: "My edit" } });
    const definition = defineSyncOperation({
      name: "comment.edit",
      version: 1,
      arguments: v.object({ body: v.string() }),
    });
    const operation = definition.create({
      workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
      arguments: { body: "My edit" },
    });
    const pending = await store.markSubmitted({
      draftIdentifier: saved.draftIdentifier,
      operation,
    });

    expect(pending).toMatchObject({ status: "pending", operation });
    await expect(store.discard(saved.draftIdentifier)).rejects.toThrow("still pending");
    expect(await store.list()).toEqual([pending]);
    const receipt = {
      status: "rejected",
      operationIdentifier: operation.operationIdentifier,
      workspaceIdentifier: operation.workspaceIdentifier,
      rejectedAt: 1700000001000,
      reason: { status: "retained", code: "revision_conflict", message: "The comment changed" },
    } as const;
    const rejected = await store.recordReceipt({ draftIdentifier: saved.draftIdentifier, receipt });

    expect(rejected).toMatchObject({
      status: "rejected",
      content: { body: "My edit" },
      operation,
      receipt,
    });
    await expect(
      store.save({
        draftIdentifier: saved.draftIdentifier,
        content: "Accidentally overwrite the saved request",
      }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([rejected]);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discarding an unsent draft frees queue capacity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-draft-discard-"));
  const store = createSyncDraftStore({
    storage: createSyncSqliteStorage({ directory }),
    authorityIdentifier: "https://sync.example.test",
    userIdentifier: "alice",
    maximumItems: 1,
  });

  try {
    const saved = await store.save({ content: "A draft the user discards" });

    await store.discard(saved.draftIdentifier);
    const replacement = await store.save({ content: "A replacement draft" });

    expect(await store.list()).toEqual([replacement]);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a draft replacement over the byte budget preserves the last saved input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-draft-byte-budget-"));
  const options = {
    storage: createSyncSqliteStorage({ directory }),
    authorityIdentifier: "https://sync.example.test",
    userIdentifier: "alice",
    maximumBytes: 512,
  };
  const store = createSyncDraftStore(options);

  try {
    const original = await store.save({ content: "Keep this draft" });

    await expect(
      store.save({ draftIdentifier: original.draftIdentifier, content: "x".repeat(512) }),
    ).rejects.toThrow("exceeds its byte budget");
    await store.close();
    const recovered = createSyncDraftStore(options);

    try {
      expect(await recovered.list()).toEqual([original]);
    } finally {
      await recovered.close();
    }
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each(["accepted", "rejected"] as const)(
  "a full draft store saves a bounded %s outcome and permits explicit discard",
  async (status) => {
    const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-draft-final-budget-"));
    const options = {
      storage: createSyncSqliteStorage({ directory }),
      authorityIdentifier: "https://sync.example.test",
      userIdentifier: "alice",
      maximumBytes: 700,
    };
    const store = createSyncDraftStore(options);

    try {
      const saved = await store.save({ content: "Recover this input" });
      const operation = defineSyncOperation({
        name: "comment.add",
        version: 1,
        arguments: v.object({ body: v.string() }),
      }).create({
        workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
        arguments: { body: "Recover this input" },
      });

      await store.markSubmitted({ draftIdentifier: saved.draftIdentifier, operation });
      const receipt =
        status === "accepted"
          ? {
              status,
              operationIdentifier: operation.operationIdentifier,
              workspaceIdentifier: operation.workspaceIdentifier,
              acceptedAt: Date.now(),
              result: { status: "retained" as const, value: "x".repeat(1000) },
            }
          : {
              status,
              operationIdentifier: operation.operationIdentifier,
              workspaceIdentifier: operation.workspaceIdentifier,
              rejectedAt: Date.now(),
              reason: {
                status: "retained" as const,
                code: "revision_conflict",
                message: "x".repeat(1000),
              },
            };
      const final = await store.recordReceipt({ draftIdentifier: saved.draftIdentifier, receipt });

      expect(final).toMatchObject({ status, content: "Recover this input", operation });
      expect("receipt" in final ? final.receipt : undefined).toBeUndefined();
      await store.close();
      const recovered = createSyncDraftStore(options);

      try {
        expect(await recovered.list()).toEqual([final]);
        await recovered.discard(saved.draftIdentifier);
        expect((await recovered.save({ content: "Space is available" })).status).toBe("draft");
      } finally {
        await recovered.close();
      }
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("draft transfer is atomic, preserves pending envelopes, and detects conflicts across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-draft-transfer-"));
  const storage = createSyncSqliteStorage({ directory });
  const source = createSyncDraftStore({
    storage,
    authorityIdentifier: "source",
    userIdentifier: "alice",
  });
  let target = createSyncDraftStore({
    storage,
    authorityIdentifier: "target",
    userIdentifier: "alice",
  });

  try {
    const saved = await source.save({ content: "Retain this uncertain text" });
    const operation = defineSyncOperation({
      name: "comment.add",
      version: 1,
      arguments: v.object({ body: v.string() }),
    }).create({
      workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
      arguments: { body: "Retain this uncertain text" },
    });

    await source.markSubmitted({ draftIdentifier: saved.draftIdentifier, operation });
    const records = await source.list();

    await target.importRecords(records);
    await target.importRecords(records);
    await target.close();
    target = createSyncDraftStore({
      storage,
      authorityIdentifier: "target",
      userIdentifier: "alice",
    });
    expect(await target.list()).toEqual(records);
    expect(await source.list()).toEqual(records);
    const [pending] = records;

    if (!pending) throw new Error("Transfer test requires its saved pending draft");

    await expect(
      target.importRecords([{ ...pending, content: "Conflicting user content" }]),
    ).rejects.toThrow("conflicts");
    expect(await target.list()).toEqual(records);
  } finally {
    await source.close();
    await target.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
