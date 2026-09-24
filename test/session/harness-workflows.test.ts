/** Fake harness through the real daemon socket: open, send Message, inject, acknowledge. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cueloop/schema";
import {
  createHarnessThreadController,
  type HarnessWorkflowRequest,
  type ThreadPanel,
} from "@cueloop/adapters/harness-thread-controller";
import { createDeliveredMessageStore } from "@cueloop/adapters/delivered-message-store";
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

test("all six workflows open, deliver, and acknowledge through a fake harness over the socket", async () => {
  const opened: string[] = [];
  const received: Message[] = [];
  const posted: Message[] = [];
  const delivered = createDeliveredMessageStore(join(home, "fake-harness-delivered.json"));
  const controller = createHarnessThreadController(client, {
    surface: {
      openThreads(threadId, panel) {
        opened.push(`${threadId}:${panel}`);
      },
    },
    forge: {
      async importPullRequest() {
        return { content: "diff --git a/pr.ts b/pr.ts\n", title: "PR 42" };
      },
      async postPullRequestMessage(_pr, message) {
        posted.push(message);
      },
    },
    corpus: {
      async analyzeRefineCorpus() {
        return { report: "# refine report\n\nRecurring: add tests" };
      },
    },
  });
  const identity = {
    harness: "fake",
    harnessSessionId: "fake-session",
    workspace: { repoRoot: "/repo", branch: "main" },
  };
  const cases: Array<{ request: HarnessWorkflowRequest; panel: ThreadPanel }> = [
    { request: { ...identity, workflow: "plan", content: "# Plan" }, panel: "thread" },
    { request: { ...identity, workflow: "reply", content: "# Reply" }, panel: "thread" },
    { request: { ...identity, workflow: "prototype", content: "# Prototype" }, panel: "thread" },
    {
      request: { ...identity, workflow: "diff", content: "diff --git a/a.ts b/a.ts\n" },
      panel: "changes",
    },
    { request: { ...identity, workflow: "review", pullRequestReference: "42" }, panel: "changes" },
    { request: { ...identity, workflow: "refine", proposal: "# Writeback" }, panel: "thread" },
  ];
  const adapter = {
    sendMessage(message) {
      return delivered.sendOnce(message, (payload) => {
        received.push(payload);
      });
    },
  } satisfies { sendMessage(message: Message): Promise<void> };

  expect((await controller.analyzeRefineCorpus()).report).toContain("Recurring: add tests");

  for (const { request, panel } of cases) {
    const result = await controller.openWorkflow(request);

    await client.sessionSendMessage(result.thread.id, "approved", "Ready.");
    await controller.deliverPending(result.binding.id, adapter);

    expect(result.panel).toBe(panel);
    expect(await client.deliveryPending(result.binding.id)).toEqual([]);
  }

  expect(opened.map((item) => item.split(":").at(-1))).toEqual(cases.map(({ panel }) => panel));
  expect(received).toHaveLength(6);
  expect(posted).toEqual([]);
});
