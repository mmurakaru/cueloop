import { parseArgs } from "node:util";
import * as v from "valibot";
import { createSharedRecordClient } from "./client.ts";
import { watchSharedRecords } from "./watch-records.ts";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { connectSharedOperation } from "./operation-client.ts";
import type { SyncClientOutcome } from "@cueloop/sync/serve";
import {
  sharedRecordMutators,
  sharedRecordQueries,
  sharedRecordQueryArgumentsSchema,
} from "./shared-record.ts";

export async function connectSharedRecord(arguments_: string[]): Promise<void | SyncClientOutcome> {
  const { values } = parseArgs({
    args: arguments_,
    options: {
      workspace: { type: "string" },
      limit: { type: "string" },
      "after-created-at": { type: "string" },
      "after-identifier": { type: "string" },
      content: { type: "string" },
      watch: { type: "boolean" },
      operation: { type: "string" },
      "operation-status": { type: "boolean" },
      drafts: { type: "boolean" },
    },
  });
  const queryArguments = parseSharedRecordQueryArguments(values);
  const cacheURL = process.env.SYNC_CACHE_URL;
  const userID = process.env.SYNC_USER_ID;
  const auth = process.env.SYNC_AUTH_TOKEN;

  const storage = process.env.SYNC_STORAGE_DIRECTORY
    ? createSyncSqliteStorage({ directory: process.env.SYNC_STORAGE_DIRECTORY })
    : undefined;

  if (values.drafts) {
    return inspectSharedDrafts({
      storage,
      userIdentifier: userID,
      hasOtherCommand: [
        values.watch,
        values.content !== undefined,
        values.operation !== undefined,
        values["operation-status"],
      ].some(Boolean),
    });
  }

  if (!cacheURL || !userID || !auth) {
    throw new Error("Sync client requires SYNC_CACHE_URL, SYNC_USER_ID, and SYNC_AUTH_TOKEN");
  }

  const client = createSharedRecordClient({
    cacheURL,
    userID,
    auth,
    storageKey: process.env.SYNC_STORAGE_KEY,
    storage: storage ?? "mem",
  });
  const query = sharedRecordQueries.records(queryArguments);

  try {
    if (values.operation !== undefined) {
      const authorityURL = process.env.SYNC_AUTHORITY_URL;

      if (!authorityURL) throw new Error("Sync operation client requires SYNC_AUTHORITY_URL");

      if (values.watch || values.content !== undefined)
        throw new Error("Sync operation client requires an operation-only command");

      return await connectSharedOperation({
        client,
        operationPath: values.operation,
        statusOnly: values["operation-status"] ?? false,
        authorityURL,
        auth,
      });
    }

    if (values["operation-status"])
      throw new Error("Sync operation status requires --operation <file>");

    if (values.watch) {
      if (values.content !== undefined) throw new Error("Sync watch requires a read-only query");

      return await watchSharedRecords(client, query);
    }

    const records = await client.run(query, { type: "complete" });

    if (values.content !== undefined) {
      const record = records[0];

      if (!record) throw new Error("Sync example edit requires an authorized record");

      const result = await client.mutate(
        sharedRecordMutators.edit({ id: record.id, content: values.content }),
      ).server;

      if (result.type === "error")
        throw new Error(`Sync example mutation failed: ${result.error.message}`);
    }

    process.stdout.write(JSON.stringify(await client.run(query, { type: "complete" })) + "\n");
  } finally {
    await client.close();
  }
}

async function inspectSharedDrafts(options: {
  storage: ReturnType<typeof createSyncSqliteStorage> | undefined;
  userIdentifier: string | undefined;
  hasOtherCommand: boolean;
}): Promise<void> {
  const authorityIdentifier = process.env.SYNC_AUTHORITY_URL;

  if (!options.storage || !options.userIdentifier || !authorityIdentifier) {
    throw new Error(
      "Sync draft inspection requires SYNC_STORAGE_DIRECTORY, SYNC_USER_ID, and SYNC_AUTHORITY_URL",
    );
  }

  if (options.hasOtherCommand)
    throw new Error("Sync draft inspection requires a read-only draft command");

  const drafts = createSyncDraftStore({
    storage: options.storage,
    authorityIdentifier,
    userIdentifier: options.userIdentifier,
  });

  try {
    process.stdout.write(`${JSON.stringify(await drafts.list())}\n`);
  } finally {
    await drafts.close();
  }
}

function parseSharedRecordQueryArguments(values: {
  workspace?: string;
  limit?: string;
  "after-created-at"?: string;
  "after-identifier"?: string;
}) {
  return v.parse(sharedRecordQueryArgumentsSchema, {
    workspaceIdentifier: values.workspace,
    pageSize: values.limit === undefined ? undefined : Number(values.limit),
    cursor:
      values["after-created-at"] !== undefined || values["after-identifier"] !== undefined
        ? { createdAt: Number(values["after-created-at"]), id: values["after-identifier"] }
        : undefined,
  });
}
