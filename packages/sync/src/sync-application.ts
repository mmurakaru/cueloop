import { SyncServerReadinessSchema } from "./sync-server-protocol.ts";
import {
  defineSyncWorkspaceTransferAdapter,
  SyncTransferTableSchema,
} from "./sync-transfer-adapter.ts";
import { validateSyncTextEditorSession, SyncTextEditorSourceSchema } from "./sync-text-session.ts";
import * as v from "valibot";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SyncApplication } from "./sync-server.ts";

const SyncApplicationModuleSchema = v.object({
  syncApplication: v.object({
    fetch: v.function(),
    connect: v.optional(v.function()),
    execute: v.optional(v.function()),
    openText: v.optional(v.function()),
    close: v.optional(v.function()),
    readiness: v.optional(v.function()),
    verifyReplica: v.optional(v.function()),
    transferAdapter: v.optional(
      v.object({
        identifier: v.string(),
        tables: v.array(SyncTransferTableSchema),
        verifyImport: v.function(),
      }),
    ),
    verifyWorkspaceReplica: v.optional(v.function()),
  }),
});
const SyncClientOutcomeSchema = v.optional(
  v.variant("status", [
    v.object({ status: v.literal("completed") }),
    v.object({ status: v.literal("interrupted"), signal: v.picklist(["SIGINT", "SIGTERM"]) }),
  ]),
);

export async function loadSyncApplication(path: string): Promise<SyncApplication> {
  const module = v.parse(
    SyncApplicationModuleSchema,
    await import(pathToFileURL(resolve(path)).href),
  );
  const {
    fetch,
    connect,
    execute,
    openText,
    close,
    verifyReplica,
    transferAdapter,
    verifyWorkspaceReplica,
    readiness,
  } = module.syncApplication;

  return {
    fetch: async (request) => v.parse(v.instance(Response), await fetch(request)),
    connect: connect
      ? async (arguments_) => {
          return v.parse(SyncClientOutcomeSchema, await connect(arguments_));
        }
      : undefined,
    execute: execute
      ? async (arguments_) => v.parse(SyncClientOutcomeSchema, await execute(arguments_))
      : undefined,
    openText: openText
      ? async (arguments_) =>
          validateSyncTextEditorSession(
            v.parse(SyncTextEditorSourceSchema, await openText(arguments_)),
          )
      : undefined,
    verifyReplica: verifyReplica
      ? async (configuration) => {
          await verifyReplica(configuration);
        }
      : undefined,
    transferAdapter: transferAdapter
      ? defineSyncWorkspaceTransferAdapter({
          identifier: transferAdapter.identifier,
          tables: transferAdapter.tables,
          verifyImport: async (transaction, workspaceIdentifier) => {
            await transferAdapter.verifyImport(transaction, workspaceIdentifier);
          },
        })
      : undefined,
    verifyWorkspaceReplica: verifyWorkspaceReplica
      ? async (authority) => {
          await verifyWorkspaceReplica(authority);
        }
      : undefined,
    readiness: readiness
      ? async (signal) => v.parse(SyncServerReadinessSchema, await readiness(signal))
      : undefined,
    close: close
      ? async (signal) => {
          await close(signal);
        }
      : undefined,
  };
}
