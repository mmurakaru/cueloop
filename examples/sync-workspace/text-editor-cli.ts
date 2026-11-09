import { parseArgs } from "node:util";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSharedTextEditorSession } from "./text-editor-client.ts";
import { SharedTextStateRequestSchema } from "./shared-text.ts";
import * as v from "valibot";

export async function openSharedTextEditor(arguments_: string[]) {
  const { values } = parseArgs({
    args: arguments_,
    options: { workspace: { type: "string" }, record: { type: "string" } },
  });
  const request = v.parse(SharedTextStateRequestSchema, {
    workspaceIdentifier: values.workspace,
    recordIdentifier: values.record,
  });
  const cacheURL = process.env.SYNC_CACHE_URL;
  const authorityURL = process.env.SYNC_AUTHORITY_URL;
  const userID = process.env.SYNC_USER_ID;
  const auth = process.env.SYNC_AUTH_TOKEN;
  const directory = process.env.SYNC_STORAGE_DIRECTORY;

  if (!cacheURL || !authorityURL || !userID || !auth || !directory)
    throw new Error(
      "Shared text editor requires SYNC_CACHE_URL, SYNC_AUTHORITY_URL, SYNC_USER_ID, SYNC_AUTH_TOKEN, and SYNC_STORAGE_DIRECTORY",
    );

  return createSharedTextEditorSession({
    ...request,
    cacheURL,
    authorityURL,
    userID,
    auth,
    storageKey: process.env.SYNC_STORAGE_KEY,
    storage: createSyncSqliteStorage({ directory }),
  });
}
