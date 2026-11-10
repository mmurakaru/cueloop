import { lookupSharedOperationReceipt } from "./operation-receipt-client.ts";
import { readFile } from "node:fs/promises";
import * as v from "valibot";
import {
  lookupSyncOperationOutcome,
  parseSyncOperation,
  submitSyncOperation,
  type SyncOperation,
  type SyncOperationOutcome,
} from "@cueloop/sync/operations";
import {
  sharedCommentOperations,
  sharedExecutionOperations,
  sharedTextOperations,
  sharedWorkspaceMutators,
} from "./shared-workspace.ts";
import { sharedRecordQueries } from "./shared-record.ts";
import type { createSharedRecordClient } from "./client.ts";

export async function connectSharedOperation(options: {
  client: ReturnType<typeof createSharedRecordClient>;
  operationPath: string;
  statusOnly: boolean;
  authorityURL: string;
  auth: string;
}): Promise<void> {
  const operation = parseSyncOperation(JSON.parse(await readFile(options.operationPath, "utf8")));
  const lookup = (request: SyncOperation) =>
    lookupSharedOperationReceipt({
      authorityURL: options.authorityURL,
      auth: options.auth,
      operation: request,
    });
  let outcome: SyncOperationOutcome;

  if (options.statusOnly) {
    outcome = await lookupSyncOperationOutcome({ operation, lookup });
  } else {
    v.parse(
      v.union([
        sharedExecutionOperations.request.schema,
        sharedCommentOperations.add.schema,
        sharedCommentOperations.edit.schema,
        sharedCommentOperations.remove.schema,
        sharedTextOperations.initialize.schema,
        sharedTextOperations.edit.schema,
      ]),
      operation,
    );
    await options.client.run(
      sharedRecordQueries.records({ workspaceIdentifier: operation.workspaceIdentifier }),
      { type: "complete" },
    );
    outcome = await submitSyncOperation({
      operation,
      lookup,
      submit(request) {
        if (request.name === "execution.request") {
          return options.client.mutate(
            sharedWorkspaceMutators.execution.request(
              sharedExecutionOperations.request.parse(request),
            ),
          );
        }

        if (request.name === "comment.add") {
          return options.client.mutate(
            sharedWorkspaceMutators.comment.add(sharedCommentOperations.add.parse(request)),
          );
        }

        if (request.name === "comment.edit") {
          return options.client.mutate(
            sharedWorkspaceMutators.comment.edit(sharedCommentOperations.edit.parse(request)),
          );
        }

        if (request.name === "comment.remove") {
          return options.client.mutate(
            sharedWorkspaceMutators.comment.remove(sharedCommentOperations.remove.parse(request)),
          );
        }

        if (request.name === "text.initialize") {
          return options.client.mutate(
            sharedWorkspaceMutators.text.initialize(sharedTextOperations.initialize.parse(request)),
          );
        }

        if (request.name === "text.edit") {
          return options.client.mutate(
            sharedWorkspaceMutators.text.edit(sharedTextOperations.edit.parse(request)),
          );
        }

        throw new Error("Sync example does not register this operation");
      },
    });
  }

  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
