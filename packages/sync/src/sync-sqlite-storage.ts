import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SQLiteStore,
  dropStore,
  type SQLiteDatabase,
  type StoreProvider,
} from "@rocicorp/zero/sqlite";
import * as v from "valibot";

function observeSyncStorage<Result>(telemetry: SyncTelemetry, operation: () => Result): Result {
  try {
    return operation();
  } catch (cause) {
    telemetry.event("storage", "failed");

    throw cause;
  }
}

function openSyncSqliteDatabase(filename: string, telemetry: SyncTelemetry): SQLiteDatabase {
  const database = observeSyncStorage(telemetry, () => new DatabaseSync(filename));

  observeSyncStorage(telemetry, () => chmodSync(filename, 0o600));

  return {
    close: () => database.close(),
    destroy() {
      for (const path of [filename, `${filename}-wal`, `${filename}-shm`])
        rmSync(path, { force: true });
    },
    execSync: (sql) => observeSyncStorage(telemetry, () => database.exec(sql)),
    prepare(sql) {
      const statement = observeSyncStorage(telemetry, () => {
        const prepared = database.prepare(sql);

        prepared.setReturnArrays(true);

        return prepared;
      });

      return {
        async exec(parameters) {
          observeSyncStorage(telemetry, () => statement.run(...parameters));
        },
        async all(parameters) {
          return v.parse(
            v.array(v.array(v.unknown())),
            observeSyncStorage(telemetry, () => statement.all(...parameters)),
          );
        },
      };
    },
  };
}

/** SQLite commits replica records and engine positions together through Zero's transactional store. */
export function createSyncSqliteStorage(options: {
  directory: string;
  telemetry?: SyncTelemetry;
}): StoreProvider {
  const telemetry = options.telemetry ?? getSyncTelemetry();
  const directory = resolve(v.parse(v.pipe(v.string(), v.minLength(1)), options.directory));
  const storeOptions = {
    directory,
    journalMode: "WAL",
    synchronous: "FULL",
    busyTimeout: 5000,
  } as const;
  const storeName = (name: string) => createHash("sha256").update(name).digest("hex");

  observeSyncStorage(telemetry, () => mkdirSync(directory, { recursive: true, mode: 0o700 }));
  const open = (filename: string) => openSyncSqliteDatabase(filename, telemetry);

  return {
    create: (name) =>
      observeSyncStorage(telemetry, () => new SQLiteStore(storeName(name), open, storeOptions)),
    drop: (name) => dropStore(storeName(name), open, storeOptions),
  };
}
