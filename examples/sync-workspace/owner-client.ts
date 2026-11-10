import {
  advanceSyncExecution,
  SyncExecutionObservationSchema,
  type SyncExecutionExecutor,
} from "@cueloop/sync/execution";
import { createSyncExecutionQueue } from "@cueloop/sync/execution/http";
import type { SyncClientOutcome } from "@cueloop/sync/serve";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as v from "valibot";

export async function executeSharedRequests(arguments_: string[]): Promise<SyncClientOutcome> {
  const { values } = parseArgs({
    args: arguments_,
    options: { workspace: { type: "string" }, executor: { type: "string" } },
  });
  const authorityURL = process.env.SYNC_AUTHORITY_URL;
  const auth = process.env.SYNC_AUTH_TOKEN;

  if (!values.workspace || !values.executor || !authorityURL || !auth)
    throw new Error(
      "Sync owner requires --workspace, --executor, SYNC_AUTHORITY_URL, and SYNC_AUTH_TOKEN",
    );

  const module: unknown = await import(pathToFileURL(resolve(values.executor)).href);
  const ModuleSchema = v.object({
    syncExecutor: v.object({
      identifier: v.pipe(v.string(), v.uuid()),
      recover: v.function(),
      dispatch: v.function(),
      close: v.optional(v.function()),
    }),
  });

  v.assert(ModuleSchema, module);
  const executor: SyncExecutionExecutor = {
    identifier: module.syncExecutor.identifier,
    recover: async (claim, signal) =>
      v.parse(SyncExecutionObservationSchema, await module.syncExecutor.recover(claim, signal)),
    dispatch: async (claim, signal) =>
      v.parse(SyncExecutionObservationSchema, await module.syncExecutor.dispatch(claim, signal)),
    close: async () => {
      await module.syncExecutor.close?.();
    },
  };
  const cancellation = new AbortController();
  let signal: "SIGINT" | "SIGTERM" | undefined;
  const interrupt = () => {
    signal = "SIGINT";
    cancellation.abort();
  };
  const terminate = () => {
    signal = "SIGTERM";
    cancellation.abort();
  };

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);

  try {
    const queue = createSyncExecutionQueue({
      url: new URL("execution", authorityURL).href,
      workspaceIdentifier: values.workspace,
      headers: () => ({ authorization: `Bearer ${auth}` }),
    });

    while (!cancellation.signal.aborted) {
      const report = await advanceSyncExecution({ queue, executor, signal: cancellation.signal });

      if (report) {
        const output = {
          operationIdentifier: report.claim.operationIdentifier,
          ...report.observation,
        };

        if (!process.stdout.write(`${JSON.stringify(output)}\n`))
          await once(process.stdout, "drain", { signal: cancellation.signal });
      } else {
        await setTimeout(250, undefined, { signal: cancellation.signal });
      }
    }
  } catch (cause) {
    if (!cancellation.signal.aborted) throw cause;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    await executor.close?.();
  }

  return signal ? { status: "interrupted", signal } : { status: "completed" };
}
