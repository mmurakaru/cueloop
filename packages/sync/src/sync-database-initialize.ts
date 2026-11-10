import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { v7 as uuidv7 } from "uuid";
import * as v from "valibot";
import {
  SyncAuthorityIdentitySchema,
  type SyncAuthorityIdentity,
} from "./sync-authority-protocol.ts";
import { syncAuthorityReplicaConfiguration } from "./sync-restore.ts";

/** Initialization is explicit and requires an empty database before any application server starts. */
export async function initializeSyncDatabase(options: { databaseURL: string }) {
  const migrations = await Promise.all(
    [
      "001-operation-receipt.sql",
      "002-execution.sql",
      "003-authority.sql",
      "004-restore-journal.sql",
      "005-workspace-transfer.sql",
    ].map(async (name) => {
      const source = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");

      return {
        identity: `@cueloop/sync/${name}`,
        source,
        digest: createHash("sha256").update(source).digest("hex"),
      };
    }),
  );
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    const authority = await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
      const existing =
        await transaction`SELECT class.oid FROM pg_class AS class JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema' LIMIT 1`;

      if (existing.length)
        throw new Error("Sync database initialization requires an empty database");

      for (const migration of migrations) await transaction.unsafe(migration.source).simple();

      for (const migration of migrations)
        await transaction`INSERT INTO public.sync_schema_migration (identity, digest) VALUES (${migration.identity}, ${migration.digest})`;

      const identity = v.parse(SyncAuthorityIdentitySchema, {
        authorityIdentifier: uuidv7(),
        generation: uuidv7(),
      });

      await transaction`INSERT INTO public.sync_authority (id, generation, phase) VALUES (${identity.authorityIdentifier}, ${identity.generation}, 'recovering')`;

      return identity;
    });

    return {
      status: "recovering" as const,
      authority,
      source: null,
      replica: syncAuthorityReplicaConfiguration(authority),
    };
  } finally {
    await database.end();
  }
}

/** Initial activation cannot be used to bypass a restored deployment's source-fence requirement. */
export async function activateSyncDatabase(options: {
  databaseURL: string;
  authority: SyncAuthorityIdentity;
  verifyReplica: (
    configuration: ReturnType<typeof syncAuthorityReplicaConfiguration>,
  ) => Promise<void>;
}) {
  const authority = v.parse(SyncAuthorityIdentitySchema, options.authority);
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    return await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
      const [row] = v.parse(
        v.array(v.object({ id: SyncAuthorityIdentitySchema.entries.authorityIdentifier })),
        await transaction`SELECT id::text FROM public.sync_authority WHERE id = ${authority.authorityIdentifier} AND generation = ${authority.generation} AND phase = 'recovering' AND recovered_source_generation IS NULL AND deleted_at IS NULL FOR UPDATE`,
      );

      if (!row)
        throw new Error(
          "Sync initial activation requires an initialized deployment without a restored source",
        );

      await options.verifyReplica(syncAuthorityReplicaConfiguration(authority));
      await transaction`UPDATE public.sync_authority SET phase = 'active' WHERE id = ${authority.authorityIdentifier}`;

      return { status: "active" as const, authority };
    });
  } finally {
    await database.end();
  }
}
