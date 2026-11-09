import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSyncClient } from "./sync-client.ts";
import { createSyncSqliteStorage } from "./sync-sqlite-storage.ts";
import { createSchema, table, string } from "./sync-schema.ts";

const schema = createSchema({
  tables: [table("record").columns({ id: string() }).primaryKey("id")],
});

test("a failed local store is reported separately from network connection state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-storage-failure-"));
  const storage = createSyncSqliteStorage({ directory });

  chmodSync(directory, 0o500);
  const client = createSyncClient({ schema, cacheURL: null, kvStore: storage });
  const failed = Promise.withResolvers<void>();
  const unsubscribe = client.lifecycle.subscribe((state) => {
    if (state.status === "storage-failed") failed.resolve();
  });
  const timeout = setTimeout(
    () => failed.reject(new Error("Sync test did not report the storage failure")),
    3000,
  );

  try {
    await failed.promise;
    expect(client.lifecycle.current).toMatchObject({
      status: "storage-failed",
      kind: "cannot-open",
    });
    expect(client.connection.state.current.name).not.toBe("connected");
    await client.close();
    expect(client.lifecycle.current).toEqual({ status: "closed" });
  } finally {
    clearTimeout(timeout);
    unsubscribe();
    await client.close();
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});
