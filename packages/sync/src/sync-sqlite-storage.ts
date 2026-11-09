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

function openSyncSqliteDatabase(filename: string): SQLiteDatabase {
  const database = new DatabaseSync(filename);

  chmodSync(filename, 0o600);

  return {
    close: () => database.close(),
    destroy() {
      for (const path of [filename, `${filename}-wal`, `${filename}-shm`])
        rmSync(path, { force: true });
    },
    execSync: (sql) => database.exec(sql),
    prepare(sql) {
      const statement = database.prepare(sql);

      statement.setReturnArrays(true);

      return {
        async exec(parameters) {
          statement.run(...parameters);
        },
        async all(parameters) {
          return v.parse(v.array(v.array(v.unknown())), statement.all(...parameters));
        },
      };
    },
  };
}

/** SQLite commits replica records and engine positions together through Zero's transactional store. */
export function createSyncSqliteStorage(options: { directory: string }): StoreProvider {
  const directory = resolve(v.parse(v.pipe(v.string(), v.minLength(1)), options.directory));
  const storeOptions = {
    directory,
    journalMode: "WAL",
    synchronous: "FULL",
    busyTimeout: 5000,
  } as const;
  const storeName = (name: string) => createHash("sha256").update(name).digest("hex");

  mkdirSync(directory, { recursive: true, mode: 0o700 });

  return {
    create: (name) => new SQLiteStore(storeName(name), openSyncSqliteDatabase, storeOptions),
    drop: (name) => dropStore(storeName(name), openSyncSqliteDatabase, storeOptions),
  };
}
