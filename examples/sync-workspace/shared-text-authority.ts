import type { ReadonlyJSONValue, ServerTransaction } from "@rocicorp/zero";
import { createBuilder, defineMutatorWithType, type Row } from "@cueloop/sync/schema";
import { acceptSyncOperation, SyncOperationRejection } from "@cueloop/sync/server";
import type { SyncOperation } from "@cueloop/sync/operations";
import { mergeSyncTextUpdate, readSyncTextState, type SyncTextSnapshot } from "@cueloop/sync/text";
import * as v from "valibot";
import { sharedRecordSchema } from "./workspace-schema.ts";
import {
  sharedTextOperations,
  SharedTextStateRequestSchema,
  SharedTextStateResponseSchema,
} from "./shared-text.ts";
import { authorizeSharedWorkspace, SharedWorkspaceAccessError } from "./shared-workspace-access.ts";
import type { SharedRecordContext } from "./shared-record.ts";

const builder = createBuilder(sharedRecordSchema);
const defineTextMutator = defineMutatorWithType<typeof sharedRecordSchema, SharedRecordContext>();

type TextTransaction = ServerTransaction<typeof sharedRecordSchema, unknown>;
type SharedTextRecord = Row<typeof sharedRecordSchema.tables.shared_record>;

async function acceptSharedTextOperation<
  Arguments extends ReadonlyJSONValue & { recordIdentifier: string },
>(options: {
  transaction: TextTransaction;
  context: SharedRecordContext;
  definition: { schema: v.GenericSchema<unknown, SyncOperation<Arguments>> };
  operation: unknown;
  change(record: SharedTextRecord, arguments_: Arguments): SyncTextSnapshot & { revision: number };
}) {
  return acceptSyncOperation({
    transaction: options.transaction,
    definition: options.definition,
    operation: options.operation,
    actorIdentifier: options.context.userIdentifier,
    authorize: (transaction, operation) =>
      authorizeSharedWorkspace({
        transaction,
        workspaceIdentifier: operation.workspaceIdentifier,
        actorIdentifier: options.context.userIdentifier,
      }),
    apply: async (transaction, operation, access) => {
      if (access.role === "viewer")
        throw new SyncOperationRejection({
          code: "permission_denied",
          message: "Text changes require an editor or owner",
        });

      await transaction.dbTransaction.query(
        "SELECT id FROM shared_record WHERE id = $1 AND workspace_identifier = $2 AND deleted_at IS NULL FOR UPDATE",
        [operation.arguments.recordIdentifier, operation.workspaceIdentifier],
      );
      const record = await transaction.run(
        builder.shared_record
          .where("id", operation.arguments.recordIdentifier)
          .where("workspaceIdentifier", operation.workspaceIdentifier)
          .where("deletedAt", "IS", null)
          .one(),
      );

      if (!record)
        throw new SyncOperationRejection({
          code: "record_unavailable",
          message: "Shared text record is unavailable",
        });

      const next = options.change(record, operation.arguments);
      const parent = record.textState
        ? await transaction.run(
            builder.shared_text_revision
              .where("recordIdentifier", record.id)
              .where("workspaceIdentifier", record.workspaceIdentifier)
              .where("revision", record.textRevision)
              .where("deletedAt", "IS", null)
              .one(),
          )
        : undefined;

      if (record.textState && !parent)
        throw new SyncOperationRejection({
          code: "text_history_missing",
          message: "Shared text history requires recovery before editing",
        });

      const now = Date.now();

      await transaction.mutate.shared_record.update({
        id: record.id,
        content: next.text,
        textState: next.state,
        textRevision: next.revision,
      });
      await transaction.mutate.shared_text_revision.insert({
        id: operation.operationIdentifier,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        actorIdentifier: access.actorIdentifier,
        parentIdentifier: parent?.id ?? null,
        revision: next.revision,
        content: next.text,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      return { recordIdentifier: record.id, revision: next.revision };
    },
  });
}

function validateSharedTextChange(change: () => SyncTextSnapshot): SyncTextSnapshot {
  try {
    return change();
  } catch {
    throw new SyncOperationRejection({
      code: "invalid_text_update",
      message: "Shared text update is invalid or requires missing changes",
    });
  }
}

export const sharedTextServerMutatorDefinitions = {
  text: {
    initialize: defineTextMutator(
      sharedTextOperations.initialize.schema,
      async ({ tx, args, ctx }) => {
        if (tx.location !== "server")
          throw new Error("Shared text server mutator requires an authority transaction");

        return acceptSharedTextOperation({
          transaction: tx,
          context: ctx,
          definition: sharedTextOperations.initialize,
          operation: args,
          change(record, arguments_) {
            if (record.textState !== null)
              throw new SyncOperationRejection({
                code: "text_already_initialized",
                message: "Shared text is already initialized",
              });

            const initial = validateSharedTextChange(() => readSyncTextState(arguments_.state));

            if (initial.text !== record.content)
              throw new SyncOperationRejection({
                code: "initialization_conflict",
                message: "Shared text changed before initialization",
              });

            return { ...initial, revision: 0 };
          },
        });
      },
    ),
    edit: defineTextMutator(sharedTextOperations.edit.schema, async ({ tx, args, ctx }) => {
      if (tx.location !== "server")
        throw new Error("Shared text server mutator requires an authority transaction");

      return acceptSharedTextOperation({
        transaction: tx,
        context: ctx,
        definition: sharedTextOperations.edit,
        operation: args,
        change(record, arguments_) {
          if (!record.textState)
            throw new SyncOperationRejection({
              code: "text_not_initialized",
              message: "Shared text requires explicit initialization",
            });

          if (record.textRevision >= 2147483647)
            throw new SyncOperationRejection({
              code: "text_revision_limit",
              message: "Shared text reached its revision limit",
            });

          const state = record.textState;
          const next = validateSharedTextChange(() =>
            mergeSyncTextUpdate({ state, update: arguments_.update }),
          );

          return { ...next, revision: record.textRevision + 1 };
        },
      });
    }),
  },
};

export async function readSharedTextRecord(options: {
  transaction: TextTransaction;
  actorIdentifier: string;
  request: v.InferOutput<typeof SharedTextStateRequestSchema>;
}) {
  const access = await authorizeSharedWorkspace({
    transaction: options.transaction,
    actorIdentifier: options.actorIdentifier,
    workspaceIdentifier: options.request.workspaceIdentifier,
  });
  const rows = await options.transaction.dbTransaction.query(
    'SELECT id, workspace_identifier AS "workspaceIdentifier", content, text_state AS "textState", text_revision AS "textRevision" FROM shared_record WHERE id = $1 AND workspace_identifier = $2 AND deleted_at IS NULL FOR SHARE',
    [options.request.recordIdentifier, options.request.workspaceIdentifier],
  );
  const [record] = v.parse(v.array(v.omit(SharedTextStateResponseSchema, ["role"])), [...rows]);

  if (!record) throw new SharedWorkspaceAccessError();

  return { ...record, role: access.role };
}
