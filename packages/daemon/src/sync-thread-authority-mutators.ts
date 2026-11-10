import type { ReadonlyJSONValue, ServerTransaction } from "@rocicorp/zero";
import { defineMutatorWithType, defineMutatorsWithType } from "@cueloop/sync/schema";
import { acceptSyncOperation, SyncOperationRejection } from "@cueloop/sync/server";
import { createSyncRecordIdentifier, type SyncOperation } from "@cueloop/sync/operations";
import { mergeSyncTextUpdate } from "@cueloop/sync/text";
import * as v from "valibot";
import { syncThreadSchema } from "./sync-thread-schema";
import {
  syncThreadOperations,
  SyncThreadCommandSchema,
  type SyncThreadCommand,
  SyncThreadDelegationSchema,
} from "./sync-thread-protocol";
import { authorizeSyncThreadWorkspace } from "./sync-thread-access";
import { applySyncThreadCommand, type SyncThreadPrincipal } from "./sync-thread-command";
import type { SyncThreadContext } from "./sync-thread-queries";
import { readSyncThreadPayload } from "./sync-thread-payload";
import { deleteSyncThread, lockSyncThread, writeSyncThread } from "./sync-thread-storage";
import { ThreadRecordSchema } from "./validate";
import { DaemonError } from "./errors";

type ThreadTransaction = ServerTransaction<typeof syncThreadSchema, unknown>;
interface SyncThreadMessageResult {
  messageIdentifier?: string;
}

const defineThreadMutator = defineMutatorWithType<typeof syncThreadSchema, SyncThreadContext>();

function rejectThreadCommand(cause: unknown): never {
  if (cause instanceof DaemonError)
    throw new SyncOperationRejection({
      code: cause.code === "forbidden" ? "permission_denied" : cause.code,
      message: cause.message,
    });

  if (cause instanceof v.ValiError || cause instanceof SyntaxError)
    throw new SyncOperationRejection({
      code: "invalid_command",
      message: "Sync Thread command contains invalid application data",
    });

  throw cause;
}

async function acceptThreadOperation<Arguments extends ReadonlyJSONValue>(options: {
  transaction: ThreadTransaction;
  context: SyncThreadContext;
  definition: { schema: v.GenericSchema<unknown, SyncOperation<Arguments>> };
  operation: unknown;
  apply(
    transaction: ThreadTransaction,
    operation: SyncOperation<Arguments>,
    principal: SyncThreadPrincipal,
  ): Promise<ReadonlyJSONValue>;
}) {
  return acceptSyncOperation({
    ...options,
    actorIdentifier: options.context.actorIdentifier,
    authorize: (transaction, operation) =>
      authorizeSyncThreadWorkspace({
        transaction,
        workspaceIdentifier: operation.workspaceIdentifier,
        actorIdentifier: options.context.actorIdentifier,
      }),
    apply: async (transaction, operation, principal) => {
      try {
        return await options.apply(transaction, operation, principal);
      } catch (cause) {
        rejectThreadCommand(cause);
      }
    },
  });
}

async function readRequiredThreadPayload(options: {
  transaction: ThreadTransaction;
  actorIdentifier: string;
  operation: SyncOperation;
}) {
  const row = await readSyncThreadPayload(options);

  if (!row)
    throw new SyncOperationRejection({
      code: "payload_unavailable",
      message: "Sync Thread staged payload is missing or expired",
    });

  return v.parse(v.object({ payload: v.unknown() }), row).payload;
}

async function applyThreadCommand(options: {
  transaction: ThreadTransaction;
  operation: SyncOperation<{
    recordIdentifier: string;
    expectedVersion: number;
    delegation?: v.InferOutput<typeof SyncThreadDelegationSchema>;
  }>;
  command: SyncThreadCommand;
  principal: SyncThreadPrincipal;
}) {
  const { transaction, operation, command, principal } = options;
  const previous = await lockSyncThread({
    transaction,
    ...operation.arguments,
    workspaceIdentifier: operation.workspaceIdentifier,
  });
  const delegation = operation.arguments.delegation;

  if (
    delegation &&
    (principal.role !== "owner" ||
      ![
        "session.annotate",
        "session.comment",
        "session.removeAnnotation",
        "session.setParticipantName",
      ].includes(command.method))
  )
    throw new SyncOperationRejection({
      code: "permission_denied",
      message: "Sync Thread delegation requires an owner mediating a comment operation",
    });

  const effectivePrincipal = delegation
    ? { actorIdentifier: delegation.actorIdentifier, role: "editor" as const }
    : principal;
  const change = applySyncThreadCommand({
    thread: previous.document,
    ...command,
    principal: effectivePrincipal,
  });

  const messageResult: SyncThreadMessageResult = {};

  if (command.method === "session.sendMessage" && change.resultThread?.message?.id)
    messageResult.messageIdentifier = change.resultThread.message.id;

  if (!change.events.length)
    return {
      recordIdentifier: operation.arguments.recordIdentifier,
      threadIdentifier: previous.document.id,
      version: previous.version,
      ...messageResult,
    };

  if (previous.version !== operation.arguments.expectedVersion)
    throw new SyncOperationRejection({
      code: "thread_version_conflict",
      message: "Sync Thread changed before this command was accepted",
    });

  if (!change.resultThread) {
    await deleteSyncThread({
      transaction,
      recordIdentifier: operation.arguments.recordIdentifier,
      workspaceIdentifier: operation.workspaceIdentifier,
    });

    return { recordIdentifier: operation.arguments.recordIdentifier, deleted: true };
  }

  const forked = change.resultThread.id !== previous.document.id;
  const recordIdentifier = forked
    ? createSyncRecordIdentifier()
    : operation.arguments.recordIdentifier;

  const result = await writeSyncThread({
    transaction,
    workspaceIdentifier: operation.workspaceIdentifier,
    recordIdentifier,
    thread: change.resultThread,
    previous: forked ? undefined : previous,
    resetText: [
      "session.navigate",
      "session.switch",
      "session.branch",
      "session.submitRevision",
    ].includes(command.method),
  });

  return { ...result, ...messageResult };
}

export const syncThreadServerMutators = defineMutatorsWithType<typeof syncThreadSchema>()({
  thread: {
    import: defineThreadMutator(
      syncThreadOperations.import.schema,
      async ({ tx: transaction, args: operation, ctx: context }) => {
        if (transaction.location !== "server")
          throw new Error("Sync Thread import requires an authority transaction");

        return acceptThreadOperation({
          transaction,
          context,
          definition: syncThreadOperations.import,
          operation,
          apply: async (acceptedTransaction, acceptedOperation, principal) => {
            if (principal.role !== "owner")
              throw new SyncOperationRejection({
                code: "permission_denied",
                message: "Sync Thread import requires an owner",
              });

            const document = v.parse(
              ThreadRecordSchema,
              await readRequiredThreadPayload({
                transaction: acceptedTransaction,
                actorIdentifier: principal.actorIdentifier,
                operation: acceptedOperation,
              }),
            );

            await acceptedTransaction.dbTransaction.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
              [`cueloop-thread:${acceptedOperation.workspaceIdentifier}:${document.id}`],
            );
            const rows = await acceptedTransaction.dbTransaction.query(
              "SELECT id FROM cueloop_sync_thread WHERE (workspace_identifier = $1 AND thread_identifier = $2) OR id = $3",
              [
                acceptedOperation.workspaceIdentifier,
                document.id,
                acceptedOperation.arguments.recordIdentifier,
              ],
            );

            if ([...rows].length)
              throw new SyncOperationRejection({
                code: "thread_already_imported",
                message: "Sync Thread identity is already reserved by this authority",
              });

            return writeSyncThread({
              transaction: acceptedTransaction,
              workspaceIdentifier: acceptedOperation.workspaceIdentifier,
              recordIdentifier: acceptedOperation.arguments.recordIdentifier,
              thread: document,
            });
          },
        });
      },
    ),
    command: defineThreadMutator(
      syncThreadOperations.command.schema,
      async ({ tx: transaction, args: operation, ctx: context }) => {
        if (transaction.location !== "server")
          throw new Error("Sync Thread command requires an authority transaction");

        return acceptThreadOperation({
          transaction,
          context,
          definition: syncThreadOperations.command,
          operation,
          apply: (acceptedTransaction, acceptedOperation, principal) =>
            applyThreadCommand({
              transaction: acceptedTransaction,
              operation: acceptedOperation,
              command: v.parse(SyncThreadCommandSchema, acceptedOperation.arguments),
              principal,
            }),
        });
      },
    ),
    stagedCommand: defineThreadMutator(
      syncThreadOperations.stagedCommand.schema,
      async ({ tx: transaction, args: operation, ctx: context }) => {
        if (transaction.location !== "server")
          throw new Error("Sync Thread command requires an authority transaction");

        return acceptThreadOperation({
          transaction,
          context,
          definition: syncThreadOperations.stagedCommand,
          operation,
          apply: async (acceptedTransaction, acceptedOperation, principal) => {
            const parameters = await readRequiredThreadPayload({
              transaction: acceptedTransaction,
              actorIdentifier: principal.actorIdentifier,
              operation: acceptedOperation,
            });

            return applyThreadCommand({
              transaction: acceptedTransaction,
              operation: acceptedOperation,
              command: v.parse(SyncThreadCommandSchema, {
                method: acceptedOperation.arguments.method,
                parameters,
              }),
              principal,
            });
          },
        });
      },
    ),
    editText: defineThreadMutator(
      syncThreadOperations.editText.schema,
      async ({ tx: transaction, args: operation, ctx: context }) => {
        if (transaction.location !== "server")
          throw new Error("Sync Thread editing requires an authority transaction");

        return acceptThreadOperation({
          transaction,
          context,
          definition: syncThreadOperations.editText,
          operation,
          apply: async (acceptedTransaction, acceptedOperation, principal) => {
            if (principal.role === "viewer")
              throw new SyncOperationRejection({
                code: "permission_denied",
                message: "Sync Thread editing requires an editor or owner",
              });

            const previous = await lockSyncThread({
              transaction: acceptedTransaction,
              ...acceptedOperation.arguments,
              workspaceIdentifier: acceptedOperation.workspaceIdentifier,
            });

            if (
              !previous.text_state ||
              previous.text_document_identifier !== acceptedOperation.arguments.documentIdentifier
            )
              throw new SyncOperationRejection({
                code: "text_generation_conflict",
                message: "Sync Thread text changed its base; preserve and rebase the local draft",
              });

            if (previous.text_revision >= Number.MAX_SAFE_INTEGER)
              throw new SyncOperationRejection({
                code: "text_revision_limit",
                message: "Sync Thread reached its text revision limit",
              });

            let next;

            try {
              next = mergeSyncTextUpdate({
                state: previous.text_state,
                update: acceptedOperation.arguments.update,
              });
            } catch {
              throw new SyncOperationRejection({
                code: "invalid_text_update",
                message: "Sync Thread text update is invalid or requires missing changes",
              });
            }

            const change = applySyncThreadCommand({
              thread: previous.document,
              method: "session.setWorkingCopy",
              parameters: { id: previous.document.id, workingCopy: next.text },
              principal,
            });

            if (!change.resultThread)
              throw new Error("Sync Thread text command must retain its Thread");

            return writeSyncThread({
              transaction: acceptedTransaction,
              workspaceIdentifier: acceptedOperation.workspaceIdentifier,
              recordIdentifier: acceptedOperation.arguments.recordIdentifier,
              thread: change.resultThread,
              previous,
              text: {
                state: next.state,
                identifier: acceptedOperation.arguments.documentIdentifier,
                revision: previous.text_revision + 1,
              },
            });
          },
        });
      },
    ),
  },
});
