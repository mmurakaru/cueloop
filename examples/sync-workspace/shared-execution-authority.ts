import * as v from "valibot";
import { defineMutatorWithType } from "@cueloop/sync/schema";
import { acceptSyncExecution } from "@cueloop/sync/execution/server";
import { SyncOperationRejection } from "@cueloop/sync/server";
import { sharedRecordSchema } from "./workspace-schema.ts";
import { sharedExecutionOperations } from "./shared-execution.ts";
import { authorizeSharedWorkspace } from "./shared-workspace-access.ts";
import type { SharedRecordContext } from "./shared-record.ts";

type SharedExecutionPromptInput = {
  text: string;
  context?: string;
};

const defineExecutionMutator = defineMutatorWithType<
  typeof sharedRecordSchema,
  SharedRecordContext
>();

export const sharedExecutionServerMutatorDefinitions = {
  execution: {
    request: defineExecutionMutator(
      sharedExecutionOperations.request.schema,
      async ({ tx, args, ctx }) => {
        if (tx.location !== "server")
          throw new Error("Shared execution authority requires a server transaction");

        await acceptSyncExecution({
          transaction: tx,
          definition: sharedExecutionOperations.request,
          operation: args,
          actorIdentifier: ctx.userIdentifier,
          authorize: (transaction, operation) =>
            authorizeSharedWorkspace({
              transaction,
              workspaceIdentifier: operation.workspaceIdentifier,
              actorIdentifier: ctx.userIdentifier,
            }),
          prepare: async (transaction, operation, access) => {
            if (access.role === "viewer")
              throw new SyncOperationRejection({
                code: "permission_denied",
                message: "Agent requests require an editor or owner",
              });

            const rows = await transaction.dbTransaction.query(
              "SELECT id FROM shared_record WHERE id = $1 AND workspace_identifier = $2 AND deleted_at IS NULL FOR SHARE",
              [operation.arguments.recordIdentifier, operation.workspaceIdentifier],
            );
            const [record] = v.parse(v.array(v.object({ id: v.string() })), [...rows]);

            if (!record)
              throw new SyncOperationRejection({
                code: "record_unavailable",
                message: "Agent request target is unavailable",
              });

            const input: SharedExecutionPromptInput = { text: operation.arguments.text };

            if (operation.arguments.context !== undefined)
              input.context = operation.arguments.context;

            return {
              targetIdentifier: record.id,
              action: "agent.prompt",
              input,
            };
          },
        });
      },
    ),
  },
};
