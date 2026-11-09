import * as v from "valibot";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SyncApplication } from "./sync-server.ts";

const SyncApplicationModuleSchema = v.object({
  syncApplication: v.object({
    fetch: v.function(),
    connect: v.optional(v.function()),
    close: v.optional(v.function()),
  }),
});

export async function loadSyncApplication(path: string): Promise<SyncApplication> {
  const module = v.parse(
    SyncApplicationModuleSchema,
    await import(pathToFileURL(resolve(path)).href),
  );
  const { fetch, connect, close } = module.syncApplication;

  return {
    fetch: async (request) => v.parse(v.instance(Response), await fetch(request)),
    connect: connect
      ? async (arguments_) => {
          await connect(arguments_);
        }
      : undefined,
    close: close
      ? async () => {
          await close();
        }
      : undefined,
  };
}
