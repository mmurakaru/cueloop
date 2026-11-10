import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as v from "valibot";
import { SyncMigrationDigestSchema } from "./sync-backup-manifest.ts";

export interface SyncDatabaseMigration {
  identity: string;
  path: string;
}

/** Migrations run while fenced; their SQL and immutable digests commit in one transaction. */
export async function migrateSyncDatabase(options: {
  databaseURL: string;
  migrations: readonly SyncDatabaseMigration[];
  signal?: AbortSignal;
}) {
  const migrations = await Promise.all(
    options.migrations.map(async (migration) => {
      const source = await readFile(migration.path, "utf8");
      const metadata = v.parse(SyncMigrationDigestSchema, {
        identity: migration.identity,
        digest: createHash("sha256").update(source).digest("hex"),
      });

      if (Buffer.byteLength(source) > 16 * 1024 * 1024)
        throw new Error("Sync migration exceeds its source byte budget");

      return { ...metadata, source };
    }),
  );

  if (new Set(migrations.map((migration) => migration.identity)).size !== migrations.length)
    throw new Error("Sync migration identities must be unique");

  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    return await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
      const [authority] =
        await transaction`SELECT phase FROM public.sync_authority WHERE singleton FOR UPDATE`;

      if (authority?.phase === "active")
        throw new Error("Sync migration requires a fenced or recovering authority");

      // Functions prevent migration SQL from committing the caller's transaction.
      await transaction
        .unsafe(
          "CREATE FUNCTION pg_temp.apply_sync_database_migration(migration_source text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE migration_source; END $$",
        )
        .simple();

      for (const migration of migrations) {
        options.signal?.throwIfAborted();
        const [applied] =
          await transaction`SELECT digest FROM public.sync_schema_migration WHERE identity = ${migration.identity}`;

        if (applied) {
          if (applied.digest !== migration.digest)
            throw new Error("Sync migration source conflicts with its applied digest");

          continue;
        }

        await transaction`SELECT pg_temp.apply_sync_database_migration(${migration.source})`;
        options.signal?.throwIfAborted();
        await transaction`INSERT INTO public.sync_schema_migration (identity, digest) VALUES (${migration.identity}, ${migration.digest})`;
      }

      return {
        status: "migrated" as const,
        migrations: migrations.map(({ identity, digest }) => ({ identity, digest })),
      };
    });
  } finally {
    await database.end();
  }
}
