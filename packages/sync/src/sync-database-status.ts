import postgres from "postgres";
import * as v from "valibot";
import { SyncAuthorityIdentitySchema } from "./sync-authority-protocol.ts";
import { syncAuthorityReplicaConfiguration } from "./sync-restore.ts";

export async function readSyncDatabaseStatus(databaseURL: string) {
  const database = postgres(databaseURL, { max: 1, onnotice: () => {} });

  try {
    return await database.begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        const [row] =
          await transaction`SELECT id::text AS "authorityIdentifier", generation::text, phase, schema_revision AS "schemaRevision", recovered_source_generation::text AS "recoveredSourceGeneration", restored_snapshot_at AS "restoredSnapshotAt" FROM public.sync_authority WHERE singleton AND deleted_at IS NULL`;

        if (!row) return { status: "uninitialized" as const, ready: false as const };

        const authority = v.parse(
          v.object({
            ...SyncAuthorityIdentitySchema.entries,
            phase: v.picklist(["active", "recovering", "fenced"]),
            schemaRevision: v.literal(1),
            recoveredSourceGeneration: v.nullable(SyncAuthorityIdentitySchema.entries.generation),
            restoredSnapshotAt: v.nullable(v.date()),
          }),
          row,
        );
        const [execution] =
          await transaction`SELECT count(*)::integer AS held FROM public.sync_execution WHERE recovery_held AND deleted_at IS NULL`;
        const heldExecutions = v.parse(v.number(), execution?.held);

        return {
          status: authority.phase,
          ready: authority.phase === "active",
          authority: {
            authorityIdentifier: authority.authorityIdentifier,
            generation: authority.generation,
          },
          schemaRevision: authority.schemaRevision,
          recoveredSourceGeneration: authority.recoveredSourceGeneration,
          restoredSnapshotAt: authority.restoredSnapshotAt?.toISOString() ?? null,
          heldExecutions,
          replica: syncAuthorityReplicaConfiguration(authority),
        };
      },
    );
  } finally {
    await database.end();
  }
}
