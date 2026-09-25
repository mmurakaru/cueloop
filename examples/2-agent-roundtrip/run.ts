#!/usr/bin/env bun
/**
 * Terminal A: bun run examples/2-agent-roundtrip/run.ts
 * Terminal B: cueloop
 * This simulates a harness submitting a Thread and waiting for its Message.
 */

import { runHarnessBridge } from "../../packages/adapters/harness-bridge";

const harnessSessionId =
  process.env.CUELOOP_EXAMPLE_SESSION_ID ?? `example-${Date.now().toString(36)}`;
const opened = await runHarnessBridge({
  operation: "open",
  harness: "claude-code",
  harnessSessionId,
  cwd: process.cwd(),
  workflow: "plan",
  content: "# Example Plan\n\n## Goal\n\nProve the round-trip works end to end.\n",
});

if (opened.operation !== "open") throw new Error("example did not open a Thread");
console.log(`Thread ${opened.threadId} is ready for review.`);
if (opened.manualOpenCommand) console.log(opened.manualOpenCommand);

for (;;) {
  const pending = await runHarnessBridge({
    operation: "pending",
    harness: "claude-code",
    harnessSessionId,
  });

  if (pending.operation !== "pending") throw new Error("example could not read pending Messages");
  const delivery = pending.deliveries[0];

  if (delivery) {
    console.log(delivery.wakeText);
    await runHarnessBridge({
      operation: "ack",
      bindingId: delivery.bindingId,
      deliveryId: delivery.deliveryId,
      messageId: delivery.message.id,
    });

    break;
  }
  await Bun.sleep(250);
}
