import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { runHarnessBridge } from "./harness-bridge";

let home: string;
let server: DaemonServer;
let client: DaemonClient;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-harness-bridge-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
});

afterEach(() => {
  client.close();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("runHarnessBridge", () => {
  test("opens one plan, exposes durable Message, acknowledges, and permits one retry", async () => {
    const request = {
      operation: "open" as const,
      harness: "claude-code" as const,
      harnessSessionId: "claude-session-1",
      cwd: home,
      workflow: "plan" as const,
      content: "# Plan\n\nShip it.",
    };
    const first = await runHarnessBridge(request, home);

    expect(first.operation).toBe("open");
    if (first.operation !== "open") throw new Error("expected an opened Thread");
    expect(first.approvedRetry).toBeFalse();
    await client.sessionSendMessage(first.threadId, "approved", "Looks good.");
    const pending = await runHarnessBridge(
      { operation: "pending", harness: "claude-code", harnessSessionId: "claude-session-1" },
      home,
    );

    expect(pending.operation).toBe("pending");
    if (pending.operation !== "pending") throw new Error("expected pending Messages");
    expect(pending.deliveries).toHaveLength(1);
    expect(pending.deliveries[0]?.wakeText).toContain("Looks good.");
    const delivery = pending.deliveries[0]!;

    await runHarnessBridge(
      {
        operation: "ack",
        bindingId: delivery.bindingId,
        deliveryId: delivery.deliveryId,
        messageId: delivery.message.id,
      },
      home,
    );
    const after = await runHarnessBridge(
      { operation: "pending", harness: "claude-code", harnessSessionId: "claude-session-1" },
      home,
    );

    expect(after.operation).toBe("pending");
    if (after.operation !== "pending") throw new Error("expected pending Messages");
    expect(after.deliveries).toEqual([]);
    const retry = await runHarnessBridge(request, home);

    expect(retry.operation).toBe("open");
    if (retry.operation !== "open") throw new Error("expected an opened Thread");
    expect(retry.approvedRetry).toBeTrue();
    const second = await runHarnessBridge(request, home);

    expect(second.operation).toBe("open");
    if (second.operation !== "open") throw new Error("expected an opened Thread");
    expect(second.approvedRetry).toBeFalse();
  });

  test("keeps a mismatched acknowledgement pending", async () => {
    const opened = await runHarnessBridge(
      {
        operation: "open",
        harness: "codex",
        harnessSessionId: "codex-1",
        cwd: home,
        workflow: "reply",
        content: "# Reply\n\nHello.",
      },
      home,
    );

    expect(opened.operation).toBe("open");
    if (opened.operation !== "open") throw new Error("expected an opened Thread");
    await client.sessionSendMessage(opened.threadId, "changes_requested", "Change the greeting.");
    const pending = await runHarnessBridge(
      { operation: "pending", harness: "codex", harnessSessionId: "codex-1" },
      home,
    );

    expect(pending.operation).toBe("pending");
    if (pending.operation !== "pending") throw new Error("expected pending Messages");
    const delivery = pending.deliveries[0]!;

    await expect(
      runHarnessBridge(
        {
          operation: "ack",
          bindingId: delivery.bindingId,
          deliveryId: delivery.deliveryId,
          messageId: "wrong-message",
        },
        home,
      ),
    ).rejects.toThrow("does not match");
    expect(await client.deliveryPending(delivery.bindingId)).toHaveLength(1);
  });

  test("delivers and acknowledges Comment while the Thread stays pending", async () => {
    const opened = await runHarnessBridge(
      {
        operation: "open",
        harness: "codex",
        harnessSessionId: "codex-comment",
        cwd: home,
        workflow: "reply",
        content: "# Reply\n\nHello.",
      },
      home,
    );

    expect(opened.operation).toBe("open");
    if (opened.operation !== "open") throw new Error("expected an opened Thread");
    await client.sessionSendMessage(opened.threadId, "comment", "Consider the greeting.");
    const pending = await runHarnessBridge(
      { operation: "pending", harness: "codex", harnessSessionId: "codex-comment" },
      home,
    );

    expect(pending.operation).toBe("pending");
    if (pending.operation !== "pending") throw new Error("expected pending Messages");
    expect(pending.pendingThreadIds).toEqual([opened.threadId]);
    expect(pending.deliveries).toHaveLength(1);
    expect(pending.deliveries[0]!.threadStatus).toBe("pending");
    expect(pending.deliveries[0]!.wakeText).toContain("has new comments");
    expect(pending.deliveries[0]!.wakeText).toContain("Consider the greeting.");
    const delivery = pending.deliveries[0]!;

    await runHarnessBridge(
      {
        operation: "ack",
        bindingId: delivery.bindingId,
        deliveryId: delivery.deliveryId,
        messageId: delivery.message.id,
      },
      home,
    );
    const after = await runHarnessBridge(
      { operation: "pending", harness: "codex", harnessSessionId: "codex-comment" },
      home,
    );

    expect(after.operation).toBe("pending");
    if (after.operation !== "pending") throw new Error("expected pending Messages");
    expect(after.deliveries).toEqual([]);
    expect(after.pendingThreadIds).toEqual([opened.threadId]);
  });
});
