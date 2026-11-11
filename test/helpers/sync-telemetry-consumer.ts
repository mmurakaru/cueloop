import assert from "node:assert/strict";
import * as v from "valibot";
import { SyncWorkspaceAuthoritySchema } from "@cueloop/sync/authority";
import { submitSyncOperation, lookupSyncOperationOutcome } from "@cueloop/sync/operations";
import {
  sharedCommentOperations,
  sharedWorkspaceMutators,
  sharedWorkspaceQueries,
} from "../../examples/sync-workspace/shared-workspace.ts";
import { lookupSharedOperationReceipt } from "../../examples/sync-workspace/operation-receipt-client.ts";
import { createTestSyncTelemetry } from "./sync-telemetry-setup.ts";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import { editSharedRecord } from "../../examples/sync-workspace/shared-record-edit-client.ts";
import { fetchSyncWorkspaceAuthority } from "@cueloop/sync/authority/client";
import { waitForTestSyncState } from "./sync-test-deadline.ts";

const endpoint = process.env.CUELOOP_TEST_OTLP_ENDPOINT;
const authority = v.parse(
  SyncWorkspaceAuthoritySchema,
  JSON.parse(process.env.CUELOOP_TEST_AUTHORITY ?? "null"),
);
const authorityURL = process.env.SYNC_AUTHORITY_URL;
const auth = process.env.SYNC_AUTH_TOKEN;
const cacheURL = process.env.SYNC_CACHE_URL;
const userID = process.env.SYNC_USER_ID;

if (!endpoint || !authority || !authorityURL || !auth || !cacheURL || !userID)
  throw new Error("Sync telemetry consumer fixture requires deployment configuration");

const telemetryError = Promise.withResolvers<void>();
const reportTestSyncTelemetryError = () => {
  process.stdout.write(JSON.stringify({ event: "sync.telemetry.error" }) + "\n");
  telemetryError.resolve();
};
const telemetry = createTestSyncTelemetry(
  endpoint,
  `sync-test-${process.versions.bun ? "bun" : "node"}`,
  reportTestSyncTelemetryError,
);
const client = createSharedRecordClient({ authority, cacheURL, auth, userID });

try {
  const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

  assert(record);
  await fetchSyncWorkspaceAuthority({
    authorityURL,
    workspaceIdentifier: record.workspaceIdentifier,
    headers: { authorization: `Bearer ${auth}` },
  });
  await editSharedRecord({
    client,
    authorityURL,
    auth,
    workspaceIdentifier: record.workspaceIdentifier,
    recordIdentifier: record.id,
    content: "Private telemetry test document content",
  });
  const operation = sharedCommentOperations.add.create({
    authority,
    workspaceIdentifier: record.workspaceIdentifier,
    arguments: { recordIdentifier: record.id, body: "Private telemetry test comment body" },
  });
  const submit = () =>
    submitSyncOperation({
      operation,
      submit: (input) => client.mutate(sharedWorkspaceMutators.comment.add(input)),
    });
  const accepted = await submit();

  assert.equal(accepted.status, "accepted");
  assert.deepEqual(await submit(), accepted);
  assert.deepEqual(
    await lookupSyncOperationOutcome({
      operation,
      lookup: (input) => lookupSharedOperationReceipt({ authorityURL, auth, operation: input }),
    }),
    accepted,
  );
  const comments = await client.run(
    sharedWorkspaceQueries.comments({
      workspaceIdentifier: record.workspaceIdentifier,
      recordIdentifier: record.id,
    }),
    { type: "complete" },
  );

  assert.equal(
    comments.filter((comment) => comment.id === operation.operationIdentifier).length,
    1,
  );
  process.stdout.write(JSON.stringify({ event: "sync.telemetry.consumer.completed" }) + "\n");
} finally {
  await client.close();
  try {
    await telemetry.shutdown();
  } catch {
    reportTestSyncTelemetryError();
  }
}

if (process.env.CUELOOP_TEST_TELEMETRY_ERROR_EXPECTED === "1")
  await waitForTestSyncState(telemetryError.promise, "an SDK error after the collector outage");
