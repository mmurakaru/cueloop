import type postgres from "postgres";
import * as v from "valibot";
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import {
  SyncAuthorityIdentitySchema,
  SyncAuthorityPhaseSchema,
  type SyncWorkspaceAuthority,
} from "./sync-authority-protocol.ts";
import {
  SyncTransferJournalSchema,
  SyncTransferWorkspaceStateSchema,
  type SyncTransferBinding,
  type SyncTransferManifest,
} from "./sync-transfer-protocol.ts";

export function digestSyncTransferValue(value: SyncTransferBinding | SyncTransferManifest) {
  const encoded = canonicalize(value);

  if (encoded === undefined) throw new Error("Sync transfer value cannot be canonicalized");

  return createHash("sha256").update(encoded).digest("hex");
}

export async function lockSyncTransferRoot(
  transaction: postgres.TransactionSql,
  authority: SyncWorkspaceAuthority,
) {
  const [root] = v.parse(
    v.array(v.object({ ...SyncAuthorityIdentitySchema.entries, phase: SyncAuthorityPhaseSchema })),
    await transaction`SELECT id::text AS "authorityIdentifier", generation::text, phase FROM public.sync_authority WHERE singleton AND deleted_at IS NULL FOR SHARE`,
  );

  if (
    !root ||
    root.phase !== "active" ||
    root.authorityIdentifier !== authority.authorityIdentifier ||
    root.generation !== authority.generation
  )
    throw new Error("Sync transfer requires the matching active deployment");

  await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${authority.workspaceIdentifier}, 1))`;
}

export async function readSyncTransferJournal(
  transaction: postgres.TransactionSql,
  workspaceIdentifier: string,
  transferIdentifier?: string,
  sourceGeneration?: string,
) {
  const [journal] = v.parse(
    v.array(SyncTransferJournalSchema),
    await transaction`SELECT binding, phase, manifest_digest AS "manifestDigest" FROM public.sync_workspace_transfer WHERE workspace_identifier = ${workspaceIdentifier} AND (${transferIdentifier ?? null}::uuid IS NULL OR id = ${transferIdentifier ?? null}::uuid) AND (${sourceGeneration ?? null}::uuid IS NULL OR binding->'source'->>'workspaceGeneration' = ${sourceGeneration ?? null}) AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
  );

  return journal;
}

export async function assertSyncTransferSourceFence(
  transaction: postgres.TransactionSql,
  binding: SyncTransferBinding,
) {
  const [root] = v.parse(
    v.array(SyncAuthorityIdentitySchema),
    await transaction`SELECT id::text AS "authorityIdentifier", generation::text FROM public.sync_authority WHERE singleton AND deleted_at IS NULL`,
  );

  if (
    !root ||
    root.authorityIdentifier !== binding.source.authorityIdentifier ||
    root.generation !== binding.source.generation
  )
    throw new Error("Sync transfer source deployment generation has changed");

  const journal = await readSyncTransferJournal(
    transaction,
    binding.source.workspaceIdentifier,
    binding.transferIdentifier,
  );
  const [workspace] = v.parse(
    v.array(SyncTransferWorkspaceStateSchema),
    await transaction`SELECT generation::text, phase FROM public.sync_workspace_authority WHERE workspace_identifier = ${binding.source.workspaceIdentifier} AND deleted_at IS NULL`,
  );

  if (
    !journal ||
    journal.phase !== "fenced" ||
    digestSyncTransferValue(journal.binding) !== digestSyncTransferValue(binding) ||
    workspace?.phase !== "fenced" ||
    workspace.generation !== binding.source.workspaceGeneration
  )
    throw new Error(
      "Sync transfer requires the exact durable source fence and destination binding",
    );
}
