import { fetchSyncHttp } from "@cueloop/sync/telemetry/http";
import { SyncAuthorityRecoveryRequired } from "@cueloop/sync/authority";
import * as v from "valibot";
import {
  SyncOperationReceiptSchema,
  SyncOperationConflict,
  type SyncOperation,
} from "@cueloop/sync/operations";

export async function lookupSharedOperationReceipt(options: {
  authorityURL: string;
  auth: string;
  operation: SyncOperation;
}) {
  const response = await fetchSyncHttp(
    new URL("operation", `${options.authorityURL.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers: { authorization: `Bearer ${options.auth}`, "content-type": "application/json" },
      body: JSON.stringify(options.operation),
      signal: AbortSignal.timeout(30000),
    },
  );

  if (response.status === 425) throw new SyncAuthorityRecoveryRequired();

  if (response.status === 409) throw new SyncOperationConflict();

  if (!response.ok)
    throw new Error(`Sync operation receipt lookup failed with HTTP ${response.status}`);

  const result = v.parse(
    v.object({ receipt: v.nullable(SyncOperationReceiptSchema) }),
    await response.json(),
  );

  return result.receipt ?? undefined;
}
