import type { SyncExecutionExecutor } from "@cueloop/sync/execution";
import { runSyncExecutionWorker } from "@cueloop/sync/execution/worker";
import { createSyncExecutionQueue } from "@cueloop/sync/execution/http";
import type { SyncClientOutcome } from "@cueloop/sync/serve";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as v from "valibot";

export async function executeSharedRequests(arguments_: string[]): Promise<SyncClientOutcome> {
  const { values } = parseArgs({
    args: arguments_,
    options: { workspace: { type: "string" }, executor: { type: "string" } },
  });
  const authorityURL = process.env.SYNC_AUTHORITY_URL;
  const authenticationToken = process.env.SYNC_AUTH_TOKEN;

  if (!values.workspace || !values.executor || !authorityURL || !authenticationToken)
    throw new Error(
      "Sync owner requires --workspace, --executor, SYNC_AUTHORITY_URL, and SYNC_AUTH_TOKEN",
    );

  const module: unknown = await import(pathToFileURL(resolve(values.executor)).href);
  const ExecutionIntegrationSchema = v.object({
    identifier: v.pipe(v.string(), v.uuid()),
    recover: v.function(),
    dispatch: v.function(),
    close: v.optional(v.function()),
  });
  const ModuleSchema = v.object({
    syncExecutor: v.custom<SyncExecutionExecutor>((value) =>
      v.is(ExecutionIntegrationSchema, value),
    ),
  });
  const { syncExecutor: executor } = v.parse(ModuleSchema, module);
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
      headers: () => ({ authorization: `Bearer ${authenticationToken}` }),
    });

    await runSyncExecutionWorker({
      queue,
      executor,
      signal: cancellation.signal,
      async onReport(report) {
        const output = {
          operationIdentifier: report.claim.operationIdentifier,
          ...report.observation,
        };

        if (!process.stdout.write(`${JSON.stringify(output)}\n`))
          await once(process.stdout, "drain", { signal: cancellation.signal });
      },
    });
  } catch (cause) {
    if (!cancellation.signal.aborted) throw cause;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    await executor.close?.();
  }

  return signal ? { status: "interrupted", signal } : { status: "completed" };
}
