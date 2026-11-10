import postgres from "postgres";
import * as v from "valibot";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { v7 as uuidv7 } from "uuid";
import {
  SyncAuthorityIdentitySchema,
  type SyncAuthorityIdentity,
} from "./sync-authority-protocol.ts";
import {
  SyncBackupManifestSchema,
  SyncMigrationDigestSchema,
  digestSyncBackupArchive,
} from "./sync-backup-manifest.ts";
import { runSyncPostgresTool, type SyncPostgresTools } from "./sync-postgres-tools.ts";
import { migrateSyncDatabase, type SyncDatabaseMigration } from "./sync-database-migration.ts";

export function syncAuthorityReplicaConfiguration(identity: SyncAuthorityIdentity) {
  return {
    appID: `cs_${identity.generation.replaceAll("-", "")}`,
    freshReplicaRequired: true as const,
  };
}

/** A failed or interrupted restore has no active authority; activation is a separate fenced operation. */
export async function restoreSyncBackup(options: {
  databaseURL: string;
  directory: string;
  tools?: SyncPostgresTools;
  signal?: AbortSignal;
}) {
  const directory = resolve(options.directory);
  const manifest = v.parse(
    SyncBackupManifestSchema,
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );
  const archive = join(directory, "application.dump");

  if ((await digestSyncBackupArchive(archive)) !== manifest.archiveDigest)
    throw new Error("Sync backup archive digest does not match its manifest");

  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });
  const connection = await database.reserve();

  try {
    await connection`SELECT pg_advisory_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
    const objects =
      await connection`SELECT objectid FROM (SELECT class.oid AS objectid FROM pg_class AS class JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema' UNION ALL SELECT routine.oid FROM pg_proc AS routine JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema' UNION ALL SELECT namespace.oid FROM pg_namespace AS namespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname NOT IN ('public', 'information_schema')) AS existing LIMIT 1`;

    if (objects.length)
      throw new Error("Sync restore requires a clean offline destination database");

    await connection`DROP SCHEMA IF EXISTS public`;
    await runSyncPostgresTool({
      command: options.tools?.restore ?? ["pg_restore"],
      arguments: [
        "--dbname=",
        "--single-transaction",
        "--exit-on-error",
        "--no-password",
        "--no-owner",
        "--no-acl",
        "--no-publications",
        "--no-subscriptions",
      ],
      databaseURL: options.databaseURL,
      inputPath: archive,
      signal: options.signal,
    });
    const identity = v.parse(SyncAuthorityIdentitySchema, {
      authorityIdentifier: manifest.authority.authorityIdentifier,
      generation: uuidv7(),
    });

    await connection`BEGIN`;

    try {
      const transaction = connection;
      const roots = await transaction`SELECT id FROM public.sync_authority`;

      if (roots.length)
        throw new Error("Sync restore archive contains an activatable source authority");

      const migrations = v.parse(
        v.array(SyncMigrationDigestSchema),
        await transaction`SELECT identity, digest FROM public.sync_schema_migration WHERE deleted_at IS NULL ORDER BY identity`,
      );

      if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations))
        throw new Error("Sync restore migration ledger differs from its snapshot manifest");

      await transaction`INSERT INTO public.sync_authority (id, generation, phase, recovered_source_generation, restored_snapshot_at) VALUES (${identity.authorityIdentifier}, ${identity.generation}, 'recovering', ${manifest.authority.generation}, ${manifest.snapshotStartedAt})`;
      await transaction`UPDATE public.sync_execution SET recovery_held = true, lease_identifier = NULL, lease_generation = NULL, lease_expires_at = NULL WHERE status NOT IN ('completed', 'failed') AND deleted_at IS NULL`;
      await connection`COMMIT`;
    } catch (cause) {
      await connection`ROLLBACK`;

      throw cause;
    }

    return {
      status: "recovering" as const,
      authority: identity,
      source: manifest.authority,
      replica: syncAuthorityReplicaConfiguration(identity),
      snapshotStartedAt: manifest.snapshotStartedAt,
    };
  } finally {
    await connection`SELECT pg_advisory_unlock(hashtextextended('cueloop-sync-database-operator', 0))`.catch(
      () => {},
    );
    connection.release();
    await database.end();
  }
}

/** Source fencing drains committing transactions; an unreachable source is never treated as fenced. */
export async function fenceSyncAuthority(options: {
  databaseURL: string;
  authority: SyncAuthorityIdentity;
}) {
  const identity = v.parse(SyncAuthorityIdentitySchema, options.authority);
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    const rows =
      await database`UPDATE public.sync_authority SET phase = 'fenced' WHERE id = ${identity.authorityIdentifier} AND generation = ${identity.generation} AND phase IN ('active', 'fenced') AND deleted_at IS NULL RETURNING id`;

    if (rows.length !== 1)
      throw new Error("Sync authority fence does not match the source generation");

    return { status: "fenced" as const, authority: identity };
  } finally {
    await database.end();
  }
}

/** The host proves fresh replica readiness before the destination can accept writes. */
export async function activateSyncRestore(options: {
  databaseURL: string;
  sourceDatabaseURL: string;
  source: SyncAuthorityIdentity;
  authority: SyncAuthorityIdentity;
  verifyReplica: (
    configuration: ReturnType<typeof syncAuthorityReplicaConfiguration>,
  ) => Promise<void>;
  migrations?: readonly SyncDatabaseMigration[];
  signal?: AbortSignal;
}) {
  const identity = v.parse(SyncAuthorityIdentitySchema, options.authority);
  const source = v.parse(SyncAuthorityIdentitySchema, options.source);

  if (
    identity.authorityIdentifier !== source.authorityIdentifier ||
    identity.generation === source.generation
  )
    throw new Error(
      "Sync restore activation requires the retained identity and a fresh generation",
    );

  const original = postgres(options.sourceDatabaseURL, { max: 1, onnotice: () => {} });
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    const [fenced] =
      await original`SELECT phase FROM public.sync_authority WHERE id = ${source.authorityIdentifier} AND generation = ${source.generation} AND deleted_at IS NULL`;

    if (fenced?.phase !== "fenced")
      throw new Error("Sync restore activation requires a verified source fence");

    await migrateSyncDatabase({
      databaseURL: options.databaseURL,
      migrations: options.migrations ?? [],
      signal: options.signal,
    });
    await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
      const [target] =
        await transaction`SELECT phase FROM public.sync_authority WHERE id = ${identity.authorityIdentifier} AND generation = ${identity.generation} AND recovered_source_generation = ${source.generation} AND deleted_at IS NULL FOR UPDATE`;

      if (target?.phase !== "recovering")
        throw new Error("Sync restore activation does not match a recovering destination");

      options.signal?.throwIfAborted();
      await options.verifyReplica(syncAuthorityReplicaConfiguration(identity));
      options.signal?.throwIfAborted();
      await transaction`UPDATE public.sync_authority SET phase = 'active' WHERE id = ${identity.authorityIdentifier}`;
    });

    return { status: "active" as const, authority: identity };
  } finally {
    await original.end();
    await database.end();
  }
}
