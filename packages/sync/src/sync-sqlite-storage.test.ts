import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncSqliteStorage } from "./sync-sqlite-storage.ts";

test("committed replica data survives reopening while an abandoned write leaves no changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-replica-"));
  const provider = createSyncSqliteStorage({ directory });
  const original = provider.create("workspace/replica");

  try {
    const write = await original.write();

    try {
      await write.put("record", { body: "Committed", revision: 2 });
      await write.put("applied-position", "engine-owned-position");
      await write.commit();
    } finally {
      write.release();
    }

    const abandoned = await original.write();

    try {
      await abandoned.put("record", { body: "Uncommitted", revision: 3 });
      await abandoned.put("applied-position", "uncommitted-position");
    } finally {
      abandoned.release();
    }

    await original.close();
    const recovered = provider.create("workspace/replica");

    try {
      const read = await recovered.read();

      try {
        expect(await read.get("record")).toEqual({ body: "Committed", revision: 2 });
        expect(await read.get("applied-position")).toBe("engine-owned-position");
      } finally {
        read.release();
      }
    } finally {
      await recovered.close();
    }
  } finally {
    await original.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("logical store names remain isolated when their punctuation differs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-store-names-"));
  const provider = createSyncSqliteStorage({ directory });
  const first = provider.create("workspace/owner");
  const second = provider.create("workspace_owner");

  try {
    const write = await first.write();

    try {
      await write.put("private-draft", "Only the first store");
      await write.commit();
    } finally {
      write.release();
    }

    const read = await second.read();

    try {
      expect(await read.get("private-draft")).toBeUndefined();
    } finally {
      read.release();
    }

    await first.close();
    await provider.drop("workspace/owner");
    const retained = await second.write();

    try {
      await retained.put("own-draft", "The second store remains usable");
      await retained.commit();
      expect(await retained.get("own-draft")).toBe("The second store remains usable");
    } finally {
      retained.release();
    }
  } finally {
    await first.close();
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a Node process writes replica storage that Bun can reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-node-storage-"));
  const source = `
    import {createSyncSqliteStorage} from '@cueloop/sync/storage';
    const storage = createSyncSqliteStorage({directory: process.argv[1]});
    const store = storage.create('shared-runtime-store');
    const write = await store.write();
    try {
      await write.put('record', {body: 'Persisted by Node'});
      await write.commit();
    } finally {
      write.release();
      await store.close();
    }
  `;

  try {
    const child = Bun.spawn(["node", "--input-type=module", "-e", source, directory], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(5000),
    });
    const [error, status] = await Promise.all([new Response(child.stderr).text(), child.exited]);

    expect(status, error).toBe(0);
    const store = createSyncSqliteStorage({ directory }).create("shared-runtime-store");

    try {
      const read = await store.read();

      try {
        expect(await read.get("record")).toEqual({ body: "Persisted by Node" });
      } finally {
        read.release();
      }
    } finally {
      await store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
