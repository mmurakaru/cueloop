import * as v from "valibot";
import { SyncVersionSevenIdentifierSchema } from "./sync-identifiers.ts";
import { SyncWorkspaceAuthoritySchema } from "./sync-authority-protocol.ts";
import { SyncMigrationDigestSchema } from "./sync-backup-manifest.ts";

export const SyncTransferIdentifierSchema = v.pipe(
  SyncVersionSevenIdentifierSchema,
  v.brand("SyncTransferIdentifier"),
);
export const SyncTransferBindingSchema = v.strictObject({
  transferIdentifier: SyncTransferIdentifierSchema,
  source: SyncWorkspaceAuthoritySchema,
  target: SyncWorkspaceAuthoritySchema,
  adapterIdentifier: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  adapterDigest: SyncMigrationDigestSchema.entries.digest,
});
export const SyncTransferManifestSchema = v.strictObject({
  format: v.literal("cueloop-sync-workspace"),
  version: v.literal(1),
  binding: SyncTransferBindingSchema,
  migrations: v.array(SyncMigrationDigestSchema),
  archiveDigest: SyncMigrationDigestSchema.entries.digest,
  rowCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});
export const SyncTransferJournalSchema = v.object({
  binding: SyncTransferBindingSchema,
  phase: v.picklist(["fenced", "imported", "active"]),
  manifestDigest: v.nullable(SyncMigrationDigestSchema.entries.digest),
});

export type SyncTransferBinding = v.InferOutput<typeof SyncTransferBindingSchema>;
export type SyncTransferManifest = v.InferOutput<typeof SyncTransferManifestSchema>;
export type SyncTransferJournal = v.InferOutput<typeof SyncTransferJournalSchema>;

export const SyncTransferWorkspaceStateSchema = v.object({
  generation: SyncWorkspaceAuthoritySchema.entries.workspaceGeneration,
  phase: v.picklist(["active", "fenced"]),
});
