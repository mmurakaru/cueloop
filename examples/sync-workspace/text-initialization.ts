import * as v from "valibot";
import { createSyncTextState } from "@cueloop/sync/text";
import { submitSyncOperation } from "@cueloop/sync/operations";
import type { createSyncDraftStore } from "@cueloop/sync/drafts";
import type { createSharedRecordClient } from "./client.ts";
import {
  sharedTextOperations,
  sharedWorkspaceMutators,
  sharedWorkspaceQueries,
} from "./shared-workspace.ts";
import { lookupSharedOperationReceipt } from "./operation-receipt-client.ts";

export async function initializeSharedText(options: {
  client: ReturnType<typeof createSharedRecordClient>;
  drafts: ReturnType<typeof createSyncDraftStore>;
  authorityURL: string;
  auth: string;
  workspaceIdentifier: string;
  recordIdentifier: string;
  content: string;
}) {
  const records = await options.drafts.list();
  const previous = records
    .map((record) => ({
      record,
      operation:
        record.status === "pending"
          ? v.safeParse(sharedTextOperations.initialize.schema, record.operation)
          : undefined,
    }))
    .find(
      (entry) =>
        entry.operation?.success &&
        entry.operation.output.workspaceIdentifier === options.workspaceIdentifier &&
        entry.operation.output.arguments.recordIdentifier === options.recordIdentifier,
    );
  const operation = previous?.operation?.success
    ? previous.operation.output
    : sharedTextOperations.initialize.create({
        workspaceIdentifier: options.workspaceIdentifier,
        arguments: {
          recordIdentifier: options.recordIdentifier,
          state: createSyncTextState(options.content).state,
        },
      });
  const saved =
    previous?.record ??
    (await options.drafts.save({
      content: {
        kind: "shared-text-initialization",
        workspaceIdentifier: options.workspaceIdentifier,
        recordIdentifier: options.recordIdentifier,
        text: options.content,
      },
    }));

  if (saved.status === "draft")
    await options.drafts.markSubmitted({ draftIdentifier: saved.draftIdentifier, operation });

  const lookup = () =>
    lookupSharedOperationReceipt({
      authorityURL: options.authorityURL,
      auth: options.auth,
      operation,
    });

  await options.client.run(
    sharedWorkspaceQueries.textDocument({
      workspaceIdentifier: options.workspaceIdentifier,
      recordIdentifier: options.recordIdentifier,
    }),
    { type: "complete" },
  );
  const existing = await lookup();
  const outcome =
    existing ??
    (await submitSyncOperation({
      operation,
      lookup,
      submit: (value) =>
        options.client.mutate(
          sharedWorkspaceMutators.text.initialize(sharedTextOperations.initialize.parse(value)),
        ),
    }));

  if (outcome.status !== "pending") {
    await options.drafts.recordReceipt({
      draftIdentifier: saved.draftIdentifier,
      receipt: outcome,
    });

    if (outcome.status === "accepted") await options.drafts.discard(saved.draftIdentifier);
  }

  return outcome;
}
