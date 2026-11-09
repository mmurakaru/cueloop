/// <reference lib="dom" />
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReadonlyJSONValue } from "@rocicorp/zero";
import type { StoreProvider } from "@rocicorp/zero/sqlite";

interface SyncDraftStorageChange<Result> {
  value: ReadonlyJSONValue;
  result: Result;
}

interface SyncDraftStorage {
  read(): Promise<ReadonlyJSONValue | undefined>;
  update<Result>(
    change: (value: ReadonlyJSONValue | undefined) => SyncDraftStorageChange<Result>,
  ): Promise<Result>;
  close(): Promise<void>;
}

interface BrowserDraftDatabase extends DBSchema {
  snapshot: { key: string; value: ReadonlyJSONValue };
}

function createBrowserDraftStorage(scope: string): SyncDraftStorage {
  let database: Promise<IDBPDatabase<BrowserDraftDatabase>> | undefined;
  let closed = false;
  const open = () => {
    if (closed) throw new Error("Sync draft storage is closed");

    database ??= openDB<BrowserDraftDatabase>("cueloop-sync-drafts", 1, {
      upgrade(current) {
        current.createObjectStore("snapshot");
      },
      blocking() {
        void database?.then((current) => current.close());
      },
    });

    return database;
  };

  return {
    async read() {
      return (await open()).get("snapshot", scope);
    },
    async update(change) {
      const transaction = (await open()).transaction("snapshot", "readwrite", {
        durability: "strict",
      });

      try {
        const next = change(await transaction.store.get(scope));

        await transaction.store.put(next.value, scope);
        await transaction.done;

        return next.result;
      } catch (cause) {
        try {
          transaction.abort();
        } catch {}

        await transaction.done.catch(() => {});

        throw cause;
      }
    },
    async close() {
      closed = true;
      await database?.then(
        (current) => current.close(),
        () => {},
      );
    },
  };
}

export function createSyncDraftStorage(
  provider: StoreProvider | "idb",
  scope: string,
): SyncDraftStorage {
  if (provider === "idb") return createBrowserDraftStorage(scope);

  const store = provider.create(scope);

  return {
    async read() {
      const read = await store.read();

      try {
        return await read.get("drafts");
      } finally {
        read.release();
      }
    },
    async update(change) {
      const write = await store.write();

      try {
        const next = change(await write.get("drafts"));

        await write.put("drafts", next.value);
        await write.commit();

        return next.result;
      } finally {
        write.release();
      }
    },
    close: () => store.close(),
  };
}
