import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import * as v from "valibot";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SyncMigrationDigestSchema, digestSyncBackupArchive } from "./sync-backup-manifest.ts";
import {
  SyncWorkspaceAuthoritySchema,
  SyncAuthorityIdentitySchema,
  type SyncAuthorityIdentity,
  type SyncWorkspaceAuthority,
} from "./sync-authority-protocol.ts";
import {
  defineSyncWorkspaceTransferAdapter,
  syncTransferAdapterDigest,
  syncTransferTables,
  quoteSyncTransferIdentifier,
  type SyncWorkspaceTransferAdapter,
} from "./sync-transfer-adapter.ts";
import {
  SyncTransferBindingSchema,
  SyncTransferManifestSchema,
  SyncTransferWorkspaceStateSchema,
  type SyncTransferBinding,
} from "./sync-transfer-protocol.ts";
import {
  assertSyncTransferSourceFence,
  digestSyncTransferValue,
  lockSyncTransferRoot,
  readSyncTransferJournal,
} from "./sync-transfer-database.ts";
import {
  exportSyncTransferRows,
  importSyncTransferRows,
  readSyncTransferManifest,
} from "./sync-transfer-archive.ts";

export {
  defineSyncWorkspaceTransferAdapter,
  type SyncWorkspaceTransferAdapter,
} from "./sync-transfer-adapter.ts";
export {
  SyncTransferBindingSchema,
  SyncTransferJournalSchema,
  SyncTransferManifestSchema,
  SyncTransferWorkspaceStateSchema,
  type SyncTransferBinding,
} from "./sync-transfer-protocol.ts";

/** Persist the returned binding before prepare; retries must retain these exact identities. */
export function createSyncWorkspaceTransferBinding(options: {
  source: SyncWorkspaceAuthority;
  target: SyncAuthorityIdentity;
  adapter: SyncWorkspaceTransferAdapter;
}): SyncTransferBinding {
  const adapter = defineSyncWorkspaceTransferAdapter(options.adapter);
  const source = v.parse(SyncWorkspaceAuthoritySchema, options.source);
  const target = v.parse(SyncAuthorityIdentitySchema, options.target);

  return parseSyncTransferBinding(
    v.parse(SyncTransferBindingSchema, {
      transferIdentifier: uuidv7(),
      source,
      target: {
        ...target,
        workspaceIdentifier: source.workspaceIdentifier,
        workspaceGeneration: uuidv7(),
      },
      adapterIdentifier: adapter.identifier,
      adapterDigest: syncTransferAdapterDigest(adapter),
    }),
    adapter,
  );
}

async function syncTransferDirectory(path: string) {
  const directory = await open(path, "r");

  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function parseSyncTransferBinding(
  binding: SyncTransferBinding,
  adapter: SyncWorkspaceTransferAdapter,
) {
  const parsed = v.parse(SyncTransferBindingSchema, binding);

  if (
    parsed.source.workspaceIdentifier !== parsed.target.workspaceIdentifier ||
    (parsed.source.authorityIdentifier === parsed.target.authorityIdentifier &&
      parsed.source.generation === parsed.target.generation) ||
    parsed.source.workspaceGeneration === parsed.target.workspaceGeneration ||
    parsed.adapterIdentifier !== adapter.identifier ||
    parsed.adapterDigest !== syncTransferAdapterDigest(adapter)
  )
    throw new Error(
      "Sync transfer binding requires one workspace, an independent target, and the matching adapter",
    );

  return parsed;
}

/** Fence once, then export canonical rows; failures keep the source reserved for this destination. */
async function prepareSyncWorkspaceTransferState(options: {
  databaseURL: string;
  directory: string;
  binding: SyncTransferBinding;
  adapter: SyncWorkspaceTransferAdapter;
  signal?: AbortSignal;
}) {
  const adapter = defineSyncWorkspaceTransferAdapter(options.adapter);
  const binding = parseSyncTransferBinding(options.binding, adapter);
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });
  const directory = resolve(options.directory);
  const preparing = `${directory}.preparing.${randomUUID()}`;

  try {
    await database.begin(async (transaction) => {
      await lockSyncTransferRoot(transaction, binding.source);
      const installed =
        await transaction`SELECT identity FROM public.sync_schema_migration WHERE identity = '@cueloop/sync/005-workspace-transfer.sql' AND deleted_at IS NULL`;

      if (installed.length !== 1)
        throw new Error("Sync transfer requires the installed SDK migration ledger");

      const journal = await readSyncTransferJournal(
        transaction,
        binding.source.workspaceIdentifier,
        binding.transferIdentifier,
      );

      if (journal) {
        await assertSyncTransferSourceFence(transaction, binding);

        return;
      }

      const [workspace] = v.parse(
        v.array(
          v.object({
            generation: SyncWorkspaceAuthoritySchema.entries.workspaceGeneration,
            phase: SyncTransferWorkspaceStateSchema.entries.phase,
          }),
        ),
        await transaction`SELECT generation::text, phase FROM public.sync_workspace_authority WHERE workspace_identifier = ${binding.source.workspaceIdentifier} AND deleted_at IS NULL FOR UPDATE`,
      );

      if (
        !workspace ||
        workspace.phase !== "active" ||
        workspace.generation !== binding.source.workspaceGeneration
      )
        throw new Error("Sync transfer source workspace is not the matching active generation");

      options.signal?.throwIfAborted();
      await transaction`INSERT INTO public.sync_workspace_transfer (id, workspace_identifier, binding, phase) VALUES (${binding.transferIdentifier}, ${binding.source.workspaceIdentifier}, ${JSON.stringify(binding)}::text::jsonb, 'fenced')`;
      await transaction`UPDATE public.sync_workspace_authority SET phase = 'fenced' WHERE workspace_identifier = ${binding.source.workspaceIdentifier}`;
    });

    if (
      await stat(directory).then(
        () => true,
        () => false,
      )
    ) {
      const manifest = await readSyncTransferManifest(directory);

      if (digestSyncTransferValue(manifest.binding) !== digestSyncTransferValue(binding))
        throw new Error("Sync transfer directory belongs to a different handoff");

      return { status: "fenced" as const, directory, manifest };
    }

    await mkdir(preparing, { mode: 0o700 });
    const manifest = await database.begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        await assertSyncTransferSourceFence(transaction, binding);
        const migrations = v.parse(
          v.array(SyncMigrationDigestSchema),
          await transaction`SELECT identity, digest FROM public.sync_schema_migration WHERE deleted_at IS NULL ORDER BY identity`,
        );
        const rowCount = await exportSyncTransferRows({
          transaction,
          directory: preparing,
          workspaceIdentifier: binding.source.workspaceIdentifier,
          adapter,
          signal: options.signal,
        });

        return v.parse(SyncTransferManifestSchema, {
          format: "cueloop-sync-workspace",
          version: 1,
          binding,
          migrations,
          rowCount,
          archiveDigest: await digestSyncBackupArchive(join(preparing, "workspace.jsonl")),
        });
      },
    );

    await writeFile(join(preparing, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const metadata = await open(join(preparing, "manifest.json"), "r");

    try {
      await metadata.sync();
    } finally {
      await metadata.close();
    }

    await syncTransferDirectory(preparing);
    options.signal?.throwIfAborted();
    await rename(preparing, directory);
    await syncTransferDirectory(dirname(directory));

    return { status: "fenced" as const, directory, manifest };
  } finally {
    await rm(preparing, { recursive: true, force: true });
    await database.end();
  }
}

/** Import commits with its journal into a fenced workspace; unrelated deployment state stays active. */
async function importSyncWorkspaceTransferState(options: {
  databaseURL: string;
  sourceDatabaseURL: string;
  directory: string;
  adapter: SyncWorkspaceTransferAdapter;
  signal?: AbortSignal;
}) {
  const adapter = defineSyncWorkspaceTransferAdapter(options.adapter);
  const manifest = await readSyncTransferManifest(options.directory);
  const binding = parseSyncTransferBinding(manifest.binding, adapter);
  const manifestDigest = digestSyncTransferValue(manifest);
  const source = postgres(options.sourceDatabaseURL, { max: 1, onnotice: () => {} });
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    await source.begin(async (transaction) => assertSyncTransferSourceFence(transaction, binding));

    return await database.begin(async (transaction) => {
      await lockSyncTransferRoot(transaction, binding.target);
      const journal = await readSyncTransferJournal(
        transaction,
        binding.target.workspaceIdentifier,
        binding.transferIdentifier,
      );

      if (journal) {
        if (
          digestSyncTransferValue(journal.binding) !== digestSyncTransferValue(binding) ||
          journal.manifestDigest !== manifestDigest ||
          journal.phase === "fenced"
        )
          throw new Error("Sync transfer target is reserved for another handoff or archive");

        return {
          status: journal.phase,
          authority: binding.target,
          transferIdentifier: binding.transferIdentifier,
        };
      }

      const [existing] = v.parse(
        v.array(SyncTransferWorkspaceStateSchema),
        await transaction`SELECT generation::text, phase FROM public.sync_workspace_authority WHERE workspace_identifier = ${binding.target.workspaceIdentifier} FOR UPDATE`,
      );

      if (existing) {
        const previous = await readSyncTransferJournal(
          transaction,
          binding.target.workspaceIdentifier,
          undefined,
          existing.generation,
        );

        if (
          existing.phase !== "fenced" ||
          !previous ||
          previous.phase !== "fenced" ||
          previous.binding.source.workspaceGeneration !== existing.generation ||
          previous.binding.source.authorityIdentifier !== binding.target.authorityIdentifier ||
          previous.binding.source.generation !== binding.target.generation
        )
          throw new Error("Sync transfer target already owns this workspace");
      }

      const migrations = v.parse(
        v.array(SyncMigrationDigestSchema),
        await transaction`SELECT identity, digest FROM public.sync_schema_migration WHERE deleted_at IS NULL ORDER BY identity`,
      );

      if (
        manifest.migrations.some(
          (required) =>
            !migrations.some(
              (applied) =>
                applied.identity === required.identity && applied.digest === required.digest,
            ),
        )
      )
        throw new Error("Sync transfer target migration ledger is incompatible");

      if (existing) {
        for (const table of syncTransferTables(adapter).toReversed())
          await transaction.unsafe(
            `DELETE FROM public.${quoteSyncTransferIdentifier(table.table)} WHERE ${quoteSyncTransferIdentifier(table.workspaceColumn)} = $1`,
            [binding.target.workspaceIdentifier],
          );

        await transaction`UPDATE public.sync_workspace_authority SET generation = ${binding.target.workspaceGeneration}, phase = 'fenced' WHERE workspace_identifier = ${binding.target.workspaceIdentifier}`;
      } else {
        await transaction`INSERT INTO public.sync_workspace_authority (workspace_identifier, generation, phase) VALUES (${binding.target.workspaceIdentifier}, ${binding.target.workspaceGeneration}, 'fenced')`;
      }

      await importSyncTransferRows({
        transaction,
        directory: options.directory,
        manifest,
        adapter,
        signal: options.signal,
      });
      await transaction`UPDATE public.sync_execution SET recovery_held = true, lease_generation = NULL, lease_expires_at = NULL WHERE workspace_identifier = ${binding.target.workspaceIdentifier} AND status NOT IN ('completed', 'failed') AND deleted_at IS NULL`;
      await adapter.verifyImport(transaction, binding.target.workspaceIdentifier);
      await transaction`INSERT INTO public.sync_workspace_transfer (id, workspace_identifier, binding, phase, manifest_digest) VALUES (${binding.transferIdentifier}, ${binding.target.workspaceIdentifier}, ${JSON.stringify(binding)}::text::jsonb, 'imported', ${manifestDigest})`;
      options.signal?.throwIfAborted();

      return {
        status: "imported" as const,
        authority: binding.target,
        transferIdentifier: binding.transferIdentifier,
      };
    });
  } finally {
    await source.end();
    await database.end();
  }
}

/** Replica proof is application-owned and must observe the imported workspace before activation. */
async function activateSyncWorkspaceTransferState(options: {
  databaseURL: string;
  sourceDatabaseURL: string;
  binding: SyncTransferBinding;
  verifyReplica: (authority: SyncWorkspaceAuthority) => Promise<void>;
  signal?: AbortSignal;
}) {
  const binding = v.parse(SyncTransferBindingSchema, options.binding);
  const source = postgres(options.sourceDatabaseURL, { max: 1, onnotice: () => {} });
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    return await database.begin(async (transaction) => {
      await lockSyncTransferRoot(transaction, binding.target);
      const journal = await readSyncTransferJournal(
        transaction,
        binding.target.workspaceIdentifier,
        binding.transferIdentifier,
      );

      if (
        !journal ||
        digestSyncTransferValue(journal.binding) !== digestSyncTransferValue(binding) ||
        journal.phase === "fenced"
      )
        throw new Error("Sync transfer activation requires the matching imported journal");

      const [workspace] = v.parse(
        v.array(SyncTransferWorkspaceStateSchema),
        await transaction`SELECT generation::text, phase FROM public.sync_workspace_authority WHERE workspace_identifier = ${binding.target.workspaceIdentifier} AND deleted_at IS NULL FOR UPDATE`,
      );

      if (
        workspace?.generation !== binding.target.workspaceGeneration ||
        (journal.phase === "active" ? workspace.phase !== "active" : workspace.phase !== "fenced")
      )
        throw new Error("Sync transfer activation requires the reserved workspace generation");

      if (journal.phase === "active")
        return {
          status: "active" as const,
          authority: binding.target,
          transferIdentifier: binding.transferIdentifier,
        };

      await source.begin(async (sourceTransaction) =>
        assertSyncTransferSourceFence(sourceTransaction, binding),
      );
      options.signal?.throwIfAborted();
      await options.verifyReplica(binding.target);
      options.signal?.throwIfAborted();
      await transaction`UPDATE public.sync_workspace_authority SET phase = 'active' WHERE workspace_identifier = ${binding.target.workspaceIdentifier}`;
      await transaction`UPDATE public.sync_workspace_transfer SET phase = 'active' WHERE id = ${binding.transferIdentifier}`;

      return {
        status: "active" as const,
        authority: binding.target,
        transferIdentifier: binding.transferIdentifier,
      };
    });
  } finally {
    await source.end();
    await database.end();
  }
}

export async function readSyncWorkspaceTransfer(options: {
  databaseURL: string;
  workspaceIdentifier: string;
}) {
  const workspaceIdentifier = v.parse(
    SyncWorkspaceAuthoritySchema.entries.workspaceIdentifier,
    options.workspaceIdentifier,
  );
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    return await database.begin("isolation level repeatable read read only", async (transaction) =>
      readSyncTransferJournal(transaction, workspaceIdentifier),
    );
  } finally {
    await database.end();
  }
}

export { syncTransferAdapterDigest } from "./sync-transfer-adapter.ts";

export function prepareSyncWorkspaceTransfer(
  options: Parameters<typeof prepareSyncWorkspaceTransferState>[0] & { telemetry?: SyncTelemetry },
) {
  return (options.telemetry ?? getSyncTelemetry()).run(
    "transfer.prepare",
    () => prepareSyncWorkspaceTransferState(options),
    (result) => result.status,
  );
}

export function importSyncWorkspaceTransfer(
  options: Parameters<typeof importSyncWorkspaceTransferState>[0] & { telemetry?: SyncTelemetry },
) {
  return (options.telemetry ?? getSyncTelemetry()).run(
    "transfer.import",
    () => importSyncWorkspaceTransferState(options),
    (result) => result.status,
  );
}

export function activateSyncWorkspaceTransfer(
  options: Parameters<typeof activateSyncWorkspaceTransferState>[0] & { telemetry?: SyncTelemetry },
) {
  return (options.telemetry ?? getSyncTelemetry()).run(
    "transfer.activate",
    () => activateSyncWorkspaceTransferState(options),
    (result) => result.status,
  );
}
