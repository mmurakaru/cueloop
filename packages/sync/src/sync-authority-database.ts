import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import type {
  Database,
  TransactionProviderHooks,
  TransactionProviderInput,
} from "@rocicorp/zero/server";
import * as v from "valibot";
import {
  SyncAuthorityIdentitySchema,
  SyncAuthorityFenced,
  SyncAuthorityRecoveryRequired,
  SyncWorkspaceAuthoritySchema,
} from "./sync-authority-protocol.ts";
import {
  syncTransactionAuthority,
  withSyncAuthorityTransaction,
  type SyncAuthorityTransaction,
} from "./sync-authority-context.ts";
import type { SyncOperation } from "./sync-operation.ts";

const AuthorityStateSchema = v.object({
  ...SyncAuthorityIdentitySchema.entries,
  phase: v.picklist(["active", "recovering", "fenced"]),
  schemaRevision: v.literal(1),
});
const WorkspaceStateSchema = v.object({
  generation: SyncWorkspaceAuthoritySchema.entries.workspaceGeneration,
  phase: v.picklist(["active", "fenced"]),
});

export async function readSyncAuthority(transaction: SyncAuthorityTransaction) {
  const rows = await transaction.dbTransaction.query(
    'SELECT id::text AS "authorityIdentifier", generation::text, phase, schema_revision AS "schemaRevision" FROM sync_authority WHERE singleton AND deleted_at IS NULL FOR SHARE',
    [],
  );
  const [row] = [...rows];

  if (!row) throw new SyncAuthorityFenced();

  return v.parse(AuthorityStateSchema, row);
}

export async function readSyncWorkspaceAuthority(
  transaction: SyncAuthorityTransaction,
  workspaceIdentifier: string,
) {
  const authority = await readSyncAuthority(transaction);
  const rows = await transaction.dbTransaction.query(
    "SELECT generation::text, phase FROM sync_workspace_authority WHERE workspace_identifier = $1 AND deleted_at IS NULL FOR SHARE",
    [workspaceIdentifier],
  );
  const [row] = [...rows];

  if (!row) throw new SyncAuthorityRecoveryRequired();

  const workspace = v.parse(WorkspaceStateSchema, row);

  return {
    authority: v.parse(SyncWorkspaceAuthoritySchema, {
      authorityIdentifier: authority.authorityIdentifier,
      generation: authority.generation,
      workspaceIdentifier,
      workspaceGeneration: workspace.generation,
    }),
    phase: workspace.phase,
    deploymentPhase: authority.phase,
  };
}

/** The state-row share lock remains held until the same transaction commits or rolls back. */
export function createSyncAuthorityDatabase<Transaction extends SyncAuthorityTransaction>(options: {
  database: Database<Transaction>;
  telemetry?: SyncTelemetry;
  identity: v.InferInput<typeof SyncAuthorityIdentitySchema>;
}) {
  const telemetry = options.telemetry ?? getSyncTelemetry();
  const identity = Object.freeze(v.parse(SyncAuthorityIdentitySchema, options.identity));

  return {
    async transaction<Result>(
      callback: (
        transaction: Transaction,
        hooks: TransactionProviderHooks,
      ) => Result | Promise<Result>,
      input?: TransactionProviderInput,
    ): Promise<Result> {
      const observation = telemetry.start("transaction.commit");

      try {
        const result = await observation.run(() =>
          options.database.transaction(async (transaction, hooks) => {
            const current = await readSyncAuthority(transaction);

            if (
              current.phase !== "active" ||
              current.authorityIdentifier !== identity.authorityIdentifier ||
              current.generation !== identity.generation
            )
              throw new SyncAuthorityFenced();

            return withSyncAuthorityTransaction(transaction, identity, () =>
              callback(transaction, hooks),
            );
          }, input),
        );

        observation.end();

        return result;
      } catch (cause) {
        observation.end("failed");

        throw cause;
      }
    },
  } satisfies Database<Transaction>;
}

/** Existing receipts are resolved first; absent requests from another generation keep an unknown outcome. */
export async function assertSyncAuthorityOperation(
  transaction: SyncAuthorityTransaction,
  operation: Pick<SyncOperation, "workspaceIdentifier" | "authority">,
): Promise<void> {
  const identity = syncTransactionAuthority(transaction);

  if (!identity) return;

  const issued = operation.authority;

  if (
    !issued ||
    issued.authorityIdentifier !== identity.authorityIdentifier ||
    issued.generation !== identity.generation ||
    issued.workspaceIdentifier !== operation.workspaceIdentifier
  )
    throw new SyncAuthorityRecoveryRequired();

  const current = await readSyncWorkspaceAuthority(transaction, operation.workspaceIdentifier);

  if (current.authority.workspaceGeneration !== issued.workspaceGeneration)
    throw new SyncAuthorityRecoveryRequired();

  if (current.phase !== "active") throw new SyncAuthorityFenced();
}
