import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import { finalizeSyncRestore } from "./sync-restore-finalization.ts";
import {
  hasSyncDatabaseTable,
  readSyncRestoreJournal,
  reserveSyncRestoreJournal,
  syncRestoreManifestDigest,
} from "./sync-restore-journal.ts";
import postgres from "postgres";
import * as v from "valibot";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SyncAuthorityIdentitySchema,
  SyncAuthorityPhaseSchema,
  type SyncAuthorityIdentity,
} from "./sync-authority-protocol.ts";
import { SyncBackupManifestSchema, digestSyncBackupArchive } from "./sync-backup-manifest.ts";
import { runSyncPostgresTool, type SyncPostgresTools } from "./sync-postgres-tools.ts";

export function syncAuthorityReplicaConfiguration(identity: SyncAuthorityIdentity) {
  return {
    appID: `cs_${identity.generation.replaceAll("-", "")}`,
    freshReplicaRequired: true as const,
  };
}

/** A failed or interrupted restore has no active authority; activation is a separate fenced operation. */
async function restoreSyncBackupState(options: {
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
  let connection: Awaited<ReturnType<typeof database.reserve>> | undefined;

  try {
    connection = await database.reserve();
    await connection`SELECT pg_advisory_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
    let journal = await readSyncRestoreJournal(connection);

    if (!journal) {
      const objects =
        await connection`SELECT objectid FROM (SELECT class.oid AS objectid FROM pg_class AS class JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema' UNION ALL SELECT routine.oid FROM pg_proc AS routine JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema' UNION ALL SELECT namespace.oid FROM pg_namespace AS namespace WHERE namespace.nspname !~ '^pg_' AND namespace.nspname NOT IN ('public', 'information_schema')) AS existing LIMIT 1`;

      if (objects.length)
        throw new Error("Sync restore requires a clean offline destination database");

      options.signal?.throwIfAborted();
      journal = await reserveSyncRestoreJournal(connection, manifest);
    }

    if (
      journal.archiveDigest !== manifest.archiveDigest ||
      journal.manifestDigest !== syncRestoreManifestDigest(manifest) ||
      journal.sourceAuthorityIdentifier !== manifest.authority.authorityIdentifier ||
      journal.sourceGeneration !== manifest.authority.generation
    )
      throw new Error("Sync restore destination is reserved for a different archive or manifest");

    if (
      journal.phase === "prepared" &&
      !(await hasSyncDatabaseTable(connection, "public.sync_authority"))
    ) {
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
    }

    const status = await finalizeSyncRestore({
      connection,
      journal,
      manifest,
      signal: options.signal,
    });
    const identity = v.parse(SyncAuthorityIdentitySchema, {
      authorityIdentifier: journal.sourceAuthorityIdentifier,
      generation: journal.targetGeneration,
    });

    return {
      status,
      authority: identity,
      source: manifest.authority,
      replica: syncAuthorityReplicaConfiguration(identity),
      snapshotStartedAt: manifest.snapshotStartedAt,
    };
  } finally {
    if (connection) {
      await connection`SELECT pg_advisory_unlock(hashtextextended('cueloop-sync-database-operator', 0))`.catch(
        () => {},
      );
      connection.release();
    }

    await database.end();
  }
}

/** Source fencing drains committing transactions; an unreachable source is never treated as fenced. */
async function fenceSyncAuthorityState(options: {
  databaseURL: string;
  authority: SyncAuthorityIdentity;
}) {
  const identity = v.parse(SyncAuthorityIdentitySchema, options.authority);
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    const rows = v.parse(
      v.array(v.object({ id: SyncAuthorityIdentitySchema.entries.authorityIdentifier })),
      await database`UPDATE public.sync_authority SET phase = 'fenced' WHERE id = ${identity.authorityIdentifier} AND generation = ${identity.generation} AND phase IN ('active', 'fenced') AND deleted_at IS NULL RETURNING id::text`,
    );

    if (rows.length !== 1)
      throw new Error("Sync authority fence does not match the source generation");

    return { status: "fenced" as const, authority: identity };
  } finally {
    await database.end();
  }
}

/** The host proves fresh replica readiness before the destination can accept writes. */
async function activateSyncRestoreState(options: {
  databaseURL: string;
  sourceDatabaseURL: string;
  source: SyncAuthorityIdentity;
  authority: SyncAuthorityIdentity;
  verifyReplica: (
    configuration: ReturnType<typeof syncAuthorityReplicaConfiguration>,
  ) => Promise<void>;
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
    await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended('cueloop-sync-database-operator', 0))`;
      const [target] = v.parse(
        v.array(v.object({ phase: SyncAuthorityPhaseSchema })),
        await transaction`SELECT phase FROM public.sync_authority WHERE id = ${identity.authorityIdentifier} AND generation = ${identity.generation} AND recovered_source_generation = ${source.generation} AND deleted_at IS NULL FOR UPDATE`,
      );

      if (target?.phase !== "recovering" && target?.phase !== "active")
        throw new Error("Sync restore activation does not match a recovering destination");

      if (target.phase === "active") return;

      const [fenced] = v.parse(
        v.array(v.object({ generation: SyncAuthorityIdentitySchema.entries.generation })),
        await original`UPDATE public.sync_authority SET recovery_target_generation = ${identity.generation} WHERE id = ${source.authorityIdentifier} AND generation = ${source.generation} AND phase = 'fenced' AND deleted_at IS NULL AND (recovery_target_generation IS NULL OR recovery_target_generation = ${identity.generation}) RETURNING generation::text`,
      );

      if (!fenced)
        throw new Error(
          "Sync restore activation requires a verified source fence bound to this destination",
        );

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

export function restoreSyncBackup(
  options: Parameters<typeof restoreSyncBackupState>[0] & { telemetry?: SyncTelemetry },
) {
  return (options.telemetry ?? getSyncTelemetry()).run(
    "restore",
    () => restoreSyncBackupState(options),
    (result) => result.status,
  );
}

export function fenceSyncAuthority(
  options: Parameters<typeof fenceSyncAuthorityState>[0] & { telemetry?: SyncTelemetry },
) {
  return (options.telemetry ?? getSyncTelemetry()).run(
    "authority.fence",
    () => fenceSyncAuthorityState(options),
    (result) => result.status,
  );
}

export function activateSyncRestore(
  options: Parameters<typeof activateSyncRestoreState>[0] & { telemetry?: SyncTelemetry },
) {
  return (options.telemetry ?? getSyncTelemetry()).run(
    "restore.activate",
    () => activateSyncRestoreState(options),
    (result) => result.status,
  );
}
