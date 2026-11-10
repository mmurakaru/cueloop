import type postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import canonicalize from "canonicalize";
import * as v from "valibot";
import { SyncAuthorityIdentitySchema } from "./sync-authority-protocol.ts";
import { type SyncBackupManifest, SyncBackupManifestSchema } from "./sync-backup-manifest.ts";

export type SyncPostgresJournalConnection = Pick<postgres.Sql, "unsafe">;
const RestoreJournalSchema = v.object({
  sourceAuthorityIdentifier: SyncAuthorityIdentitySchema.entries.authorityIdentifier,
  sourceGeneration: SyncAuthorityIdentitySchema.entries.generation,
  targetGeneration: SyncAuthorityIdentitySchema.entries.generation,
  archiveDigest: SyncBackupManifestSchema.entries.archiveDigest,
  manifestDigest: SyncBackupManifestSchema.entries.archiveDigest,
  phase: v.picklist(["prepared", "finalized"]),
  schemaRevision: v.literal(1),
});

export type SyncRestoreJournal = v.InferOutput<typeof RestoreJournalSchema>;

export async function hasSyncDatabaseTable(
  connection: SyncPostgresJournalConnection,
  name: string,
): Promise<boolean> {
  const [row] = v.parse(
    v.array(v.object({ name: v.nullable(v.string()) })),
    await connection.unsafe("SELECT to_regclass($1)::text AS name", [name]),
  );

  return row?.name !== null && row?.name !== undefined;
}

export async function readSyncRestoreJournal(connection: SyncPostgresJournalConnection) {
  if (!(await hasSyncDatabaseTable(connection, "cueloop_sync_recovery.restore_attempt"))) return;

  const [journal] = v.parse(
    v.array(RestoreJournalSchema),
    await connection.unsafe(
      'SELECT source_authority_identifier::text AS "sourceAuthorityIdentifier", source_generation::text AS "sourceGeneration", target_generation::text AS "targetGeneration", archive_digest AS "archiveDigest", manifest_digest AS "manifestDigest", phase, schema_revision AS "schemaRevision" FROM cueloop_sync_recovery.restore_attempt WHERE singleton AND deleted_at IS NULL',
    ),
  );

  return journal;
}

export function syncRestoreManifestDigest(manifest: SyncBackupManifest): string {
  const serialized = canonicalize(manifest);

  if (serialized === undefined) throw new Error("Sync restore manifest cannot be canonicalized");

  return createHash("sha256").update(serialized).digest("hex");
}

export async function reserveSyncRestoreJournal(
  connection: SyncPostgresJournalConnection,
  manifest: SyncBackupManifest,
) {
  const source = await readFile(
    new URL("../migrations/004-restore-journal.sql", import.meta.url),
    "utf8",
  );

  await connection.unsafe("BEGIN");

  try {
    await connection.unsafe(source).simple();
    await connection.unsafe(
      "INSERT INTO cueloop_sync_recovery.restore_attempt (source_authority_identifier, source_generation, archive_digest, manifest_digest) VALUES ($1, $2, $3, $4)",
      [
        manifest.authority.authorityIdentifier,
        manifest.authority.generation,
        manifest.archiveDigest,
        syncRestoreManifestDigest(manifest),
      ],
    );
    await connection.unsafe("COMMIT");
  } catch (cause) {
    await connection.unsafe("ROLLBACK");

    throw cause;
  }

  const journal = await readSyncRestoreJournal(connection);

  if (!journal) throw new Error("Sync restore destination reservation was not persisted");

  return journal;
}
