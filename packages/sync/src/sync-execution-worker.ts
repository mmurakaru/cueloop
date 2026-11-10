import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import {
  advanceSyncExecution,
  SyncExecutionAuthorityError,
  type SyncExecutionExecutor,
  type SyncExecutionQueue,
  type SyncExecutionReport,
} from "./sync-execution.ts";

async function waitForExecutionRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);

    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One pending report survives uncertain replies; an expired lease returns to provider recovery. */
export async function runSyncExecutionWorker(options: {
  queue: SyncExecutionQueue;
  executor: SyncExecutionExecutor;
  signal: AbortSignal;
  telemetry?: SyncTelemetry;
  onReport?: (report: SyncExecutionReport) => void | Promise<void>;
}): Promise<void> {
  const telemetry = options.telemetry ?? getSyncTelemetry();

  telemetry.activeWork("execution.worker", 1);
  telemetry.event("execution.worker", "started");
  let pendingReport: SyncExecutionReport | undefined;
  let failures = 0;
  const queue: SyncExecutionQueue = {
    claim: (input) => options.queue.claim(input),
    async report(report, signal) {
      pendingReport = report;
      await options.queue.report(report, signal);
      pendingReport = undefined;
    },
  };

  try {
    while (!options.signal.aborted) {
      try {
        if (pendingReport) {
          const report = pendingReport;

          await options.queue.report(report, options.signal);
          pendingReport = undefined;
          await options.onReport?.(report);
        } else {
          const report = await advanceSyncExecution({
            queue,
            executor: options.executor,
            signal: options.signal,
            telemetry,
          });

          if (report) await options.onReport?.(report);
          else await waitForExecutionRetry(250, options.signal);
        }

        failures = 0;
      } catch (cause) {
        options.signal.throwIfAborted();

        if (!(cause instanceof SyncExecutionAuthorityError) || !cause.recoverable) throw cause;

        if (cause.statusCode === 409) pendingReport = undefined;

        await waitForExecutionRetry(Math.min(5000, 250 * 2 ** failures), options.signal);
        failures = Math.min(5, failures + 1);
      }
    }
  } finally {
    telemetry.activeWork("execution.worker", -1);
    telemetry.event("execution.worker", "closed");
  }
}
