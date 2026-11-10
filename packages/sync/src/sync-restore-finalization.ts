import * as v from "valibot";
import { SyncAuthorityPhaseSchema } from "./sync-authority-protocol.ts";
import { SyncMigrationDigestSchema, type SyncBackupManifest } from "./sync-backup-manifest.ts";
import {
  hasSyncDatabaseTable,
  type SyncPostgresJournalConnection,
  type SyncRestoreJournal,
} from "./sync-restore-journal.ts";

/** Archive import is atomic; the durable reservation owns the gap before authority finalization. */
export async function finalizeSyncRestore(options: {
  connection: SyncPostgresJournalConnection;
  journal: SyncRestoreJournal;
  manifest: SyncBackupManifest;
  signal?: AbortSignal;
}) {
  const { connection, journal, manifest } = options;

  if (journal.phase === "finalized") {
    const [authority] = v.parse(
      v.array(v.object({ phase: SyncAuthorityPhaseSchema })),
      await connection.unsafe(
        "SELECT phase FROM public.sync_authority WHERE id = $1 AND generation = $2 AND recovered_source_generation = $3 AND deleted_at IS NULL",
        [journal.sourceAuthorityIdentifier, journal.targetGeneration, journal.sourceGeneration],
      ),
    );

    if (!authority) throw new Error("Sync restore finalized journal does not match its authority");

    return authority.phase;
  }

  if (!(await hasSyncDatabaseTable(connection, "public.sync_authority")))
    throw new Error("Sync restore archive import has not committed");

  options.signal?.throwIfAborted();
  await connection.unsafe("BEGIN");

  try {
    const [count] = v.parse(
      v.array(v.object({ count: v.number() })),
      await connection.unsafe("SELECT count(*)::integer AS count FROM public.sync_authority"),
    );

    if (count?.count !== 0)
      throw new Error("Sync restore archive contains an activatable source authority");

    const migrations = v.parse(
      v.array(SyncMigrationDigestSchema),
      await connection.unsafe(
        "SELECT identity, digest FROM public.sync_schema_migration WHERE deleted_at IS NULL ORDER BY identity",
      ),
    );

    if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations))
      throw new Error("Sync restore migration ledger differs from its snapshot manifest");

    await connection.unsafe(
      "INSERT INTO public.sync_authority (id, generation, phase, recovered_source_generation, restored_snapshot_at) VALUES ($1, $2, 'recovering', $3, $4)",
      [
        journal.sourceAuthorityIdentifier,
        journal.targetGeneration,
        journal.sourceGeneration,
        manifest.snapshotStartedAt,
      ],
    );
    await connection.unsafe(
      "UPDATE public.sync_execution SET recovery_held = true, lease_generation = NULL, lease_expires_at = NULL WHERE status NOT IN ('completed', 'failed') AND deleted_at IS NULL",
    );
    await connection.unsafe(
      "UPDATE cueloop_sync_recovery.restore_attempt SET phase = 'finalized' WHERE singleton",
    );
    options.signal?.throwIfAborted();
    await connection.unsafe("COMMIT");

    return "recovering" as const;
  } catch (cause) {
    await connection.unsafe("ROLLBACK");

    throw cause;
  }
}
