import { readFile } from "node:fs/promises";
import * as v from "valibot";
import {
  parseSyncOperation,
  submitSyncOperation,
  SyncOperationReceiptSchema,
  SyncOperationConflict,
  type SyncOperation,
  type SyncOperationOutcome,
} from "@cueloop/sync/operations";
import { sharedCommentOperations, sharedWorkspaceMutators } from "./shared-workspace.ts";
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
  const lookup = async (request: SyncOperation) => {
    const response = await fetch(
      new URL("operation", `${options.authorityURL.replace(/\/$/, "")}/`),
      {
        method: "POST",
        headers: { authorization: `Bearer ${options.auth}`, "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (response.status === 409) throw new SyncOperationConflict();

    if (!response.ok)
      throw new Error(`Sync operation receipt lookup failed with HTTP ${response.status}`);

    const result = v.parse(
      v.object({ receipt: v.nullable(SyncOperationReceiptSchema) }),
      await response.json(),
    );

    return result.receipt ?? undefined;
  };
  let outcome: SyncOperationOutcome;

  if (options.statusOnly) {
    outcome = (await lookup(operation)) ?? {
      status: "pending",
      operationIdentifier: operation.operationIdentifier,
      workspaceIdentifier: operation.workspaceIdentifier,
    };
  } else {
    v.parse(
      v.union([
        sharedCommentOperations.add.schema,
        sharedCommentOperations.edit.schema,
        sharedCommentOperations.remove.schema,
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

        throw new Error("Sync example does not register this operation");
      },
    });
  }

  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
