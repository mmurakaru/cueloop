import { join } from "node:path";
import { cueloopHome } from "@cueloop/daemon/paths";
import { createDeliveredMessageStore } from "../delivered-message-store";
import { runHarnessBridge } from "../harness-bridge";
import { queueCodexMessage } from "./queue";
import { createCodexSessionRegistry } from "./session-registry";

/** Reconcile durable Messages for every active Codex session. */
export function createCodexDeliveryService(
  options: {
    home?: string;
    codexBin?: string;
    pollMs?: number;
  } = {},
) {
  const home = options.home ?? cueloopHome();
  const sessions = createCodexSessionRegistry(home);
  const delivered = createDeliveredMessageStore(join(home, "codex-delivered-messages.json"));
  let timer: ReturnType<typeof setInterval> | undefined;
  let reconciling = false;

  async function reconcile(): Promise<void> {
    if (reconciling) return;
    reconciling = true;

    try {
      for (const sessionId of sessions.list()) {
        const pending = await runHarnessBridge(
          { operation: "pending", harness: "codex", harnessSessionId: sessionId },
          home,
        );

        if (pending.operation !== "pending") throw new Error("Codex pending response mismatch");
        for (const delivery of pending.deliveries) {
          await delivered.sendOnce(delivery.message, async () => {
            const result = await queueCodexMessage({
              threadId: sessionId,
              message: delivery.wakeText,
              codexBin: options.codexBin,
              cwd: home,
            });

            if (!result.ok) throw new Error(`Codex Message injection failed: ${result.error}`);
          });
          await runHarnessBridge(
            {
              operation: "ack",
              bindingId: delivery.bindingId,
              deliveryId: delivery.deliveryId,
              messageId: delivery.message.id,
            },
            home,
          );
        }
      }
    } finally {
      reconciling = false;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void reconcile().catch((error) => console.error(`cueloop Codex delivery: ${String(error)}`));
    }, options.pollMs ?? 1000);
    void reconcile().catch((error) => console.error(`cueloop Codex delivery: ${String(error)}`));
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { reconcile, start, stop };
}
