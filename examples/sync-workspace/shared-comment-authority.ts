import type { ServerTransaction } from "@rocicorp/zero";
import { createBuilder, defineMutatorWithType } from "@cueloop/sync/schema";
import { acceptSyncOperation, SyncOperationRejection } from "@cueloop/sync/server";
import { sharedRecordSchema } from "./workspace-schema.ts";
import { sharedCommentOperations } from "./shared-comment.ts";
import { authorizeSharedWorkspace, type SharedWorkspaceAccess } from "./shared-workspace-access.ts";
import type { SharedRecordContext } from "./shared-record.ts";

const builder = createBuilder(sharedRecordSchema);
const defineCommentMutator = defineMutatorWithType<
  typeof sharedRecordSchema,
  SharedRecordContext
>();

type CommentTransaction = ServerTransaction<typeof sharedRecordSchema, unknown>;
function requireCommentWrite(access: SharedWorkspaceAccess): void {
  if (access.role === "viewer") {
    throw new SyncOperationRejection({
      code: "permission_denied",
      message: "Comment changes require an editor or owner",
    });
  }
}

async function lockWritableComment(options: {
  transaction: CommentTransaction;
  access: SharedWorkspaceAccess;
  commentIdentifier: string;
  expectedRevision: number;
}) {
  requireCommentWrite(options.access);
  await options.transaction.dbTransaction.query(
    "SELECT id FROM shared_comment WHERE id = $1 AND workspace_identifier = $2 AND deleted_at IS NULL FOR UPDATE",
    [options.commentIdentifier, options.access.workspaceIdentifier],
  );
  const comment = await options.transaction.run(
    builder.shared_comment
      .where("id", options.commentIdentifier)
      .where("workspaceIdentifier", options.access.workspaceIdentifier)
      .where("deletedAt", "IS", null)
      .one(),
  );

  if (!comment)
    throw new SyncOperationRejection({
      code: "comment_unavailable",
      message: "Comment is not available",
    });

  if (
    options.access.role !== "owner" &&
    comment.authorIdentifier !== options.access.actorIdentifier
  ) {
    throw new SyncOperationRejection({
      code: "permission_denied",
      message: "Only the comment author or workspace owner can change this comment",
    });
  }

  if (comment.revision !== options.expectedRevision) {
    throw new SyncOperationRejection({
      code: "revision_conflict",
      message: "Comment changed; read its current revision before changing it",
    });
  }

  return comment;
}

export const sharedCommentServerMutatorDefinitions = {
  comment: {
    add: defineCommentMutator(sharedCommentOperations.add.schema, async ({ tx, args, ctx }) => {
      if (tx.location !== "server")
        throw new Error("Shared comment server mutator requires an authority transaction");

      return acceptSyncOperation({
        transaction: tx,
        definition: sharedCommentOperations.add,
        operation: args,
        actorIdentifier: ctx.userIdentifier,
        authorize: (transaction, operation) =>
          authorizeSharedWorkspace({
            transaction,
            workspaceIdentifier: operation.workspaceIdentifier,
            actorIdentifier: ctx.userIdentifier,
          }),
        apply: async (transaction, operation, access) => {
          requireCommentWrite(access);
          const records = await transaction.dbTransaction.query(
            "SELECT id FROM shared_record WHERE id = $1 AND workspace_identifier = $2 AND deleted_at IS NULL FOR SHARE",
            [operation.arguments.recordIdentifier, operation.workspaceIdentifier],
          );

          if (![...records].length)
            throw new SyncOperationRejection({
              code: "record_unavailable",
              message: "Shared record is not available",
            });

          const now = Date.now();

          await transaction.mutate.shared_comment.insert({
            id: operation.operationIdentifier,
            workspaceIdentifier: operation.workspaceIdentifier,
            recordIdentifier: operation.arguments.recordIdentifier,
            authorIdentifier: access.actorIdentifier,
            body: operation.arguments.body,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          return { commentIdentifier: operation.operationIdentifier, revision: 1 };
        },
      });
    }),
    edit: defineCommentMutator(sharedCommentOperations.edit.schema, async ({ tx, args, ctx }) => {
      if (tx.location !== "server")
        throw new Error("Shared comment server mutator requires an authority transaction");

      return acceptSyncOperation({
        transaction: tx,
        definition: sharedCommentOperations.edit,
        operation: args,
        actorIdentifier: ctx.userIdentifier,
        authorize: (transaction, operation) =>
          authorizeSharedWorkspace({
            transaction,
            workspaceIdentifier: operation.workspaceIdentifier,
            actorIdentifier: ctx.userIdentifier,
          }),
        apply: async (transaction, operation, access) => {
          const comment = await lockWritableComment({
            transaction,
            access,
            commentIdentifier: operation.arguments.commentIdentifier,
            expectedRevision: operation.arguments.expectedRevision,
          });
          const revision = comment.revision + 1;

          await transaction.mutate.shared_comment.update({
            id: comment.id,
            body: operation.arguments.body,
            revision,
          });

          return { commentIdentifier: comment.id, revision };
        },
      });
    }),
    remove: defineCommentMutator(
      sharedCommentOperations.remove.schema,
      async ({ tx, args, ctx }) => {
        if (tx.location !== "server")
          throw new Error("Shared comment server mutator requires an authority transaction");

        return acceptSyncOperation({
          transaction: tx,
          definition: sharedCommentOperations.remove,
          operation: args,
          actorIdentifier: ctx.userIdentifier,
          authorize: (transaction, operation) =>
            authorizeSharedWorkspace({
              transaction,
              workspaceIdentifier: operation.workspaceIdentifier,
              actorIdentifier: ctx.userIdentifier,
            }),
          apply: async (transaction, operation, access) => {
            const comment = await lockWritableComment({
              transaction,
              access,
              commentIdentifier: operation.arguments.commentIdentifier,
              expectedRevision: operation.arguments.expectedRevision,
            });
            const revision = comment.revision + 1;

            await transaction.mutate.shared_comment.update({
              id: comment.id,
              revision,
              deletedAt: Date.now(),
            });

            return { commentIdentifier: comment.id, revision, removed: true };
          },
        });
      },
    ),
  },
};
