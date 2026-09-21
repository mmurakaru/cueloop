/** Fake harness through the real daemon socket: open, send Message, inject, acknowledge. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cueloop/schema";
import { HarnessThreadController } from "@cueloop/adapters/harness-thread-controller";
import { DeliveredMessageStore } from "@cueloop/adapters/delivered-message-store";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";

let home: string;
let server: DaemonServer;
let client: DaemonClient;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-harness-workflow-socket-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
});

afterEach(() => {
  client.close();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

test("a fake harness receives and acknowledges a resolved plan Message over the socket", async () => {
  const opened: string[] = [];
  const received: Message[] = [];
  const delivered = new DeliveredMessageStore(join(home, "fake-harness-delivered.json"));
  const controller = new HarnessThreadController(client, {
    surface: {
      openThreads(threadId, panel) {
        opened.push(`${threadId}:${panel}`);
      },
    },
    forge: {
      async importPullRequest() {
        throw new Error("unexpected PR import");
      },
      async postPullRequestMessage() {
        throw new Error("unexpected PR post");
      },
    },
    corpus: {
      async analyzeRefineCorpus() {
        throw new Error("unexpected corpus analysis");
      },
    },
  });
  const openedPlan = await controller.openWorkflow({
    harness: "fake",
    harnessSessionId: "fake-session",
    workspace: { repoRoot: "/repo", branch: "main" },
    workflow: "plan",
    content: "# Plan\n\nShip it.",
  });

  await client.sessionSendMessage(openedPlan.thread.id, "approved", "Ready.");
  await controller.deliverPending(openedPlan.binding.id, {
    sendMessage(message) {

      return delivered.sendOnce(message, (payload) => {
        received.push(payload);
      });
    },
  });

  expect(opened).toEqual([`${openedPlan.thread.id}:thread`]);
  expect(received).toHaveLength(1);
  expect(received[0]!.outcome).toBe("approved");
  expect(await client.deliveryPending(openedPlan.binding.id)).toEqual([]);
});
