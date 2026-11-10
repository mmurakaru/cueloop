import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import type { ZQLDatabase } from "@rocicorp/zero/server";
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
  database: ZQLDatabase<typeof syncThreadSchema, WrappedTransaction>;
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
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;

      if (path !== "/thread-import" && path !== "/thread-command" && path !== "/operation")
        return handleSync(request);

      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

      const principal = await authenticate(request);

      if (!principal) return new Response("Unauthorized", { status: 401 });

      try {
        const input: unknown = await request.json();

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
        if (cause instanceof v.ValiError || cause instanceof SyntaxError)
          return Response.json({ error: "invalid_request" }, { status: 400 });

        if (
          cause instanceof SyncThreadAccessError ||
          (cause instanceof DaemonError && cause.code === "forbidden")
        )
          return Response.json({ error: "forbidden" }, { status: 403 });

        if (cause instanceof SyncOperationConflict)
          return Response.json({ error: "operation_conflict" }, { status: 409 });

        throw cause;
      }
    },
  };
}
