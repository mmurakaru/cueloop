import * as v from "valibot";
import {
  SyncOperationReceiptSchema,
  SyncOperationConflict,
  type SyncOperation,
} from "@cueloop/sync/operations";
import {
  SyncThreadImportUploadSchema,
  SyncThreadCommandUploadSchema,
} from "./sync-thread-protocol";

export async function uploadSyncThreadImport(options: {
  authorityURL: string;
  authenticationToken: string;
  upload: v.InferOutput<typeof SyncThreadImportUploadSchema>;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(
    new URL("thread-import", `${options.authorityURL.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.authenticationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.upload),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      redirect: "error",
    },
  );

  if (!response.ok) throw new Error(`Sync Thread staging failed with HTTP ${response.status}`);
}

export async function lookupSyncThreadOperation(options: {
  authorityURL: string;
  authenticationToken: string;
  operation: SyncOperation;
  signal?: AbortSignal;
}) {
  const response = await fetch(
    new URL("operation", `${options.authorityURL.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.authenticationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.operation),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      redirect: "error",
    },
  );

  if (response.status === 409) throw new SyncOperationConflict();

  if (!response.ok)
    throw new Error(`Sync Thread operation lookup failed with HTTP ${response.status}`);

  const result = v.parse(
    v.object({ receipt: v.nullable(SyncOperationReceiptSchema) }),
    await response.json(),
  );

  return result.receipt ?? undefined;
}

export async function uploadSyncThreadCommand(options: {
  authorityURL: string;
  authenticationToken: string;
  upload: v.InferOutput<typeof SyncThreadCommandUploadSchema>;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(
    new URL("thread-command", `${options.authorityURL.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.authenticationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.upload),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      redirect: "error",
    },
  );

  if (response.status === 409) throw new SyncOperationConflict();

  if (!response.ok)
    throw new Error(`Sync Thread command staging failed with HTTP ${response.status}`);
}
