import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Annotation, Artifact, Message, WorkspaceKey } from "@cueloop/schema";
import { DaemonCore } from "@cueloop/daemon/api";
import { DeliveredMessageStore } from "./delivered-message-store";
import {
  HarnessThreadController,
  type HarnessThreadClient,
  type HarnessMessageAdapter,
} from "./harness-thread-controller";

class FakeHarness implements HarnessMessageAdapter {
  constructor(
    private readonly delivered: DeliveredMessageStore,
    readonly received: Message[],
  ) {}

  sendMessage(message: Message): Promise<void> {
    return this.delivered.sendOnce(message, (payload) => {
      this.received.push(payload);
    });
  }
}

class CoreClient implements HarnessThreadClient {
  constructor(private readonly core: DaemonCore) {}

  async sessionList() {
    return this.core.sessionList();
  }

  async sessionCreate(workspace: WorkspaceKey, artifact: Artifact) {
    return this.core.sessionCreate({ workspace, artifact });
  }

  async sessionSubmitRevision(id: string, content: string, addressed: string[] = []) {
    return this.core.sessionSubmitRevision(id, content, addressed);
  }

  async sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ) {
    return this.core.sessionAnnotate(id, annotation, authorName);
  }

  async sessionGet(id: string) {
    return this.core.sessionGet(id);
  }

  sessionWait(id: string, timeoutMs: number) {
    return this.core.sessionWait(id, timeoutMs);
  }

  async harnessBind(threadId: string, harness: string, harnessSessionId: string) {
    return this.core.harnessBind({ threadId, harness, harnessSessionId });
  }

  async harnessConsumeApprovedRetry(bindingId: string, messageId: string, content: string) {
    return this.core.harnessConsumeApprovedRetry(bindingId, messageId, content);
  }

  async deliveryPending(bindingId: string) {
    return this.core.deliveryPending(bindingId);
  }

  async deliveryAcknowledge(deliveryId: string) {
    return this.core.deliveryAcknowledge(deliveryId);
  }
}

let home: string;
let core: DaemonCore;
let client: CoreClient;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-harness-thread-controller-"));
  core = new DaemonCore(home);
  client = new CoreClient(core);
});

afterEach(() => {
  core.dispose();
  rmSync(home, { recursive: true, force: true });
});

describe("HarnessThreadController", () => {
  test("opens, revises, retries safely, and delivers the approved Message", async () => {
    const controller = new HarnessThreadController(client);
    const received: Message[] = [];
    const journalPath = join(home, "fake-delivered-messages.json");
    const harness = new FakeHarness(new DeliveredMessageStore(journalPath), received);
    const input = {
      harness: "fake",
      harnessSessionId: "fake_1",
      content: "# Plan",
      workspace: { repoRoot: "/repo", branch: "main" },
    };
    const opened = await controller.openPlanThread(input);

    expect(opened.approvedRetry).toBe(false);

    core.sessionSendMessage(opened.thread.id, "changes_requested", "Add detail.");

    const acknowledge = client.deliveryAcknowledge.bind(client);

    client.deliveryAcknowledge = async () => {
      throw new Error("adapter stopped after native injection");
    };
    await expect(controller.deliverPending(opened.binding.id, harness)).rejects.toThrow(
      "adapter stopped",
    );
    client.deliveryAcknowledge = acknowledge;

    const reloadedHarness = new FakeHarness(new DeliveredMessageStore(journalPath), received);

    expect(await controller.deliverPending(opened.binding.id, reloadedHarness)).toBe(1);
    expect(received).toHaveLength(1);

    const revised = await controller.openPlanThread(input);

    expect(revised.thread.id).toBe(opened.thread.id);
    expect(revised.thread.revisions).toHaveLength(2);
    core.sessionSendMessage(revised.thread.id, "approved", "Ready.");
    expect(await controller.deliverPending(revised.binding.id, reloadedHarness)).toBe(1);

    expect(received.map((message) => message.outcome)).toEqual(["changes_requested", "approved"]);

    const retry = await controller.openPlanThread(input);

    expect(retry.approvedRetry).toBe(true);
    expect(retry.thread.revisions).toHaveLength(2);

    const secondRetry = await controller.openPlanThread(input);

    expect(secondRetry.approvedRetry).toBe(false);
    expect(secondRetry.thread.revisions).toHaveLength(3);
  });
});
