import { syncThreadTransferAdapter } from "./sync-thread-transfer";
import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import type { Database } from "@rocicorp/zero/server";
import type { ServerTransaction } from "@rocicorp/zero";
import { readSyncAuthority, readSyncWorkspaceAuthority } from "@cueloop/sync/authority/server";
import { SyncAuthorityFenced, SyncAuthorityRecoveryRequired } from "@cueloop/sync/authority";
import {
  createSyncAuthority,
  findSyncOperationReceipt,
  SyncOperationConflict,
} from "@cueloop/sync/server";
import { SyncOperationSchema } from "@cueloop/sync/operations";
import * as v from "valibot";
import { syncThreadSchema } from "./sync-thread-schema";
import { syncThreadQueries, type SyncThreadContext } from "./sync-thread-queries";
import { syncThreadServerMutators } from "./sync-thread-authority-mutators";
import { authorizeSyncThreadWorkspace, SyncThreadAccessError } from "./sync-thread-access";
import { stageSyncThreadCommand, stageSyncThreadImport } from "./sync-thread-payload";
import {
  SyncThreadCommandUploadSchema,
  SyncThreadImportUploadSchema,
} from "./sync-thread-protocol";
import { DaemonError } from "./errors";

/** The host owns PostgreSQL connections and verifies credentials before selecting an actor. */
export function createSyncThreadApplication<WrappedTransaction>(options: {
  database: Database<ServerTransaction<typeof syncThreadSchema, WrappedTransaction>>;
  authenticate(request: Request): Promise<{ actorIdentifier: string } | null>;
}) {
  const authenticate = async (request: Request) => {
    const actor = await options.authenticate(request);

    return actor
      ? {
          userIdentifier: actor.actorIdentifier,
          context: { actorIdentifier: actor.actorIdentifier } satisfies SyncThreadContext,
        }
      : null;
  };
  const handleSync = createSyncAuthority({
    schema: syncThreadSchema,
    database: options.database,
    authenticate,
    query: (principal) => (name, args) =>
      mustGetQuery(syncThreadQueries, name).fn({ args, ctx: principal.context }),
    mutate: (principal) => (transact) =>
      transact((transaction, name, args) =>
        mustGetMutator(syncThreadServerMutators, name).fn({
          tx: transaction,
          args,
          ctx: principal.context,
        }),
      ),
  });

  return {
    transferAdapter: syncThreadTransferAdapter,
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;

      if (
        path !== "/thread-import" &&
        path !== "/thread-command" &&
        path !== "/operation" &&
        path !== "/authority"
      )
        return handleSync(request);

      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

      const principal = await authenticate(request);

      if (!principal) return new Response("Unauthorized", { status: 401 });

      try {
        const input: unknown = await request.json();

        if (path === "/authority") {
          const descriptor = v.parse(
            v.strictObject({ workspaceIdentifier: v.optional(v.pipe(v.string(), v.uuid())) }),
            input,
          );
          const current = await options.database.transaction(async (transaction) => {
            if (!descriptor.workspaceIdentifier) {
              const authority = await readSyncAuthority(transaction);

              return {
                authority: {
                  authorityIdentifier: authority.authorityIdentifier,
                  generation: authority.generation,
                },
                phase: "active" as const,
                deploymentPhase: authority.phase,
              };
            }

            await authorizeSyncThreadWorkspace({
              transaction,
              workspaceIdentifier: descriptor.workspaceIdentifier,
              actorIdentifier: principal.userIdentifier,
            });

            return readSyncWorkspaceAuthority(transaction, descriptor.workspaceIdentifier);
          });

          if (current.phase !== "active" || current.deploymentPhase !== "active")
            throw new SyncAuthorityFenced();

          return Response.json(current.authority, { headers: { "cache-control": "no-store" } });
        }

        if (path === "/thread-import") {
          const upload = v.parse(SyncThreadImportUploadSchema, input);

          await options.database.transaction((transaction) =>
            stageSyncThreadImport({
              transaction,
              actorIdentifier: principal.userIdentifier,
              upload,
            }),
          );

          return Response.json({ staged: true });
        }

        if (path === "/thread-command") {
          const upload = v.parse(SyncThreadCommandUploadSchema, input);

          await options.database.transaction((transaction) =>
            stageSyncThreadCommand({
              transaction,
              actorIdentifier: principal.userIdentifier,
              upload,
            }),
          );

          return Response.json({ staged: true });
        }

        const operation = v.parse(SyncOperationSchema, input);
        const receipt = await options.database.transaction((transaction) =>
          findSyncOperationReceipt({
            transaction,
            definition: { schema: SyncOperationSchema },
            operation,
            actorIdentifier: principal.userIdentifier,
            authorize: async (receiptTransaction, pendingOperation) => {
              await authorizeSyncThreadWorkspace({
                transaction: receiptTransaction,
                workspaceIdentifier: pendingOperation.workspaceIdentifier,
                actorIdentifier: principal.userIdentifier,
              });
            },
          }),
        );

        return Response.json({ receipt: receipt ?? null });
      } catch (cause) {
        if (cause instanceof Error) return syncThreadAuthorityErrorResponse(cause);

        throw cause;
      }
    },
  };
}

function syncThreadAuthorityErrorResponse(error: Error): Response {
  if (error instanceof SyncAuthorityRecoveryRequired)
    return Response.json({ error: "unknown_after_recovery" }, { status: 425 });

  if (error instanceof SyncAuthorityFenced)
    return Response.json({ error: "authority_fenced" }, { status: 503 });

  if (error instanceof v.ValiError || error instanceof SyntaxError)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  if (
    error instanceof SyncThreadAccessError ||
    (error instanceof DaemonError && error.code === "forbidden")
  )
    return Response.json({ error: "forbidden" }, { status: 403 });

  if (error instanceof SyncOperationConflict)
    return Response.json({ error: "operation_conflict" }, { status: 409 });

  throw error;
}
