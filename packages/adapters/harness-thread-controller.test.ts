import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Annotation, Artifact, Message, WorkspaceKey } from "@cueloop/schema";
import { DaemonCore } from "@cueloop/daemon/api";
import {
  HarnessThreadController,
  type HarnessThreadClient,
  type HarnessMessageAdapter,
} from "./harness-thread-controller";

class FakeHarness implements HarnessMessageAdapter {
  readonly received: Message[] = [];
  private readonly seen = new Set<string>();

  sendMessage(message: Message): void {
    if (this.seen.has(message.id)) return;

    this.seen.add(message.id);
    this.received.push(message);
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
    const harness = new FakeHarness();
    const input = {
      harness: "fake",
      harnessSessionId: "fake_1",
      content: "# Plan",
      workspace: { repoRoot: "/repo", branch: "main" },
    };
    const opened = await controller.openPlanThread(input);

    core.sessionSendMessage(opened.thread.id, "changes_requested", "Add detail.");

    const acknowledge = client.deliveryAcknowledge.bind(client);

    client.deliveryAcknowledge = async () => {
      throw new Error("adapter stopped after native injection");
    };
    await expect(controller.deliverPending(opened.binding.id, harness)).rejects.toThrow(
      "adapter stopped",
    );
    client.deliveryAcknowledge = acknowledge;

    expect(await controller.deliverPending(opened.binding.id, harness)).toBe(1);
    expect(harness.received).toHaveLength(1);

    const revised = await controller.openPlanThread(input);

    expect(revised.thread.id).toBe(opened.thread.id);
    expect(revised.thread.revisions).toHaveLength(2);
    core.sessionSendMessage(revised.thread.id, "approved", "Ready.");
    expect(await controller.deliverPending(revised.binding.id, harness)).toBe(1);

    expect(harness.received.map((message) => message.outcome)).toEqual([
      "changes_requested",
      "approved",
    ]);
  });
});
