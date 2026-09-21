import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Annotation, Artifact, Message, WorkspaceKey } from "@cueloop/schema";
import { DaemonCore } from "@cueloop/daemon/api";
import { DeliveredMessageStore } from "./delivered-message-store";
import { LocalRefineCorpusPort } from "./refine-corpus";
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

  async sessionSubmitRevision(
    id: string,
    content: string,
    addressed: string[] = [],
    files?: Artifact["files"],
  ) {
    return this.core.sessionSubmitRevision(id, content, addressed, files);
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

  async harnessGetBinding(bindingId: string) {
    return this.core.harnessGetBinding(bindingId);
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
  test("a failed terminal launch returns a manual command and leaves the Thread pending", async () => {
    const controller = new HarnessThreadController(client, {
      surface: { openThreads: () => "failed" },
      forge: {
        async importPullRequest() {
          throw new Error("unexpected import");
        },
        async postPullRequestMessage() {},
      },
      corpus: new LocalRefineCorpusPort(client, home),
    });
    const opened = await controller.openWorkflow({
      workflow: "plan",
      harness: "fake",
      harnessSessionId: "manual-open",
      content: "# Pending plan",
      workspace: { repoRoot: "/repo", branch: "main" },
    });

    expect(opened.manualOpenCommand).toBe(`Open cueloop threads: cueloop ${opened.thread.id}`);
    expect((await client.sessionGet(opened.thread.id)).status).toBe("pending");
  });

  test("a second PR in one harness session opens a distinct Thread", async () => {
    const controller = new HarnessThreadController(client, {
      surface: { openThreads() {} },
      forge: {
        async importPullRequest(pr) {
          return { content: `diff --git a/${pr} b/${pr}\n` };
        },
        async postPullRequestMessage() {},
      },
      corpus: new LocalRefineCorpusPort(client, home),
    });
    const identity = {
      harness: "fake",
      harnessSessionId: "same-session",
      workspace: { repoRoot: "/repo", branch: "main" },
      workflow: "review" as const,
    };
    const first = await controller.openWorkflow({ ...identity, pullRequestReference: "42" });
    const second = await controller.openWorkflow({ ...identity, pullRequestReference: "43" });

    expect(first.thread.id).not.toBe(second.thread.id);
    expect(second.thread.artifact.meta.pr).toBe("43");
  });

  test("reopening a PR Thread keeps hunk curation disabled", async () => {
    const controller = new HarnessThreadController(client, {
      surface: { openThreads() {} },
      forge: {
        async importPullRequest() {
          return { content: "diff --git a/a.ts b/a.ts\n" };
        },
        async postPullRequestMessage() {},
      },
      corpus: new LocalRefineCorpusPort(client, home),
    });
    const input = {
      harness: "fake",
      harnessSessionId: "same-session",
      workspace: { repoRoot: "/repo", branch: "main" },
      workflow: "review" as const,
      pullRequestReference: "42",
    };
    const first = await controller.openWorkflow(input);
    const second = await controller.openWorkflow(input);

    expect(second.thread.id).toBe(first.thread.id);
    expect(second.thread.artifact.files).toBeUndefined();
  });

  test("refine uses the persisted corpus report", async () => {
    const source = core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "# Earlier plan", meta: {} },
    });

    core.sessionSendMessage(source.id, "changes_requested", "Add tests.");
    const controller = new HarnessThreadController(client, {
      surface: { openThreads() {} },
      forge: {
        async importPullRequest() {
          throw new Error("unexpected import");
        },
        async postPullRequestMessage() {
          throw new Error("unexpected post");
        },
      },
      corpus: new LocalRefineCorpusPort(client, home),
    });
    const analysis = await controller.analyzeRefineCorpus();
    const opened = await controller.openWorkflow({
      harness: "fake",
      harnessSessionId: "refine-session",
      workspace: { repoRoot: "/repo", branch: "main" },
      workflow: "refine",
      proposal: "# Writeback proposal",
    });

    expect(analysis.report).toContain("1 sessions analyzed");
    expect(opened.thread.artifact.meta.workflow).toBe("refine");
  });

  test("opens Markdown workflows in the thread panel and diff in changes", async () => {
    const opened: { threadId: string; panel: string }[] = [];
    const controller = new HarnessThreadController(client, {
      surface: {
        openThreads(threadId, panel) {
          opened.push({ threadId, panel });
        },
      },
      forge: {
        async importPullRequest() {
          throw new Error("unexpected forge import");
        },
        async postPullRequestMessage() {
          throw new Error("unexpected forge post");
        },
      },
      corpus: {
        async analyzeRefineCorpus() {
          throw new Error("unexpected corpus analysis");
        },
      },
    });
    const identity = {
      harness: "fake",
      harnessSessionId: "one-conversation",
      workspace: { repoRoot: "/repo", branch: "main" },
    };

    const plan = await controller.openWorkflow({
      ...identity,
      workflow: "plan",
      content: "# Plan",
    });
    const reply = await controller.openWorkflow({
      ...identity,
      workflow: "reply",
      content: "# Reply",
    });
    const prototype = await controller.openWorkflow({
      ...identity,
      workflow: "prototype",
      content: "# API\n\n# Composition\n\n# Callstack",
    });
    const diff = await controller.openWorkflow({
      ...identity,
      workflow: "diff",
      content: "diff --git a/a.ts b/a.ts\n",
    });

    expect([
      plan.thread.artifact.type,
      reply.thread.artifact.type,
      prototype.thread.artifact.type,
      diff.thread.artifact.type,
    ]).toEqual(["plan", "reply", "prototype", "diff"]);
    expect(
      new Set([plan.thread.id, reply.thread.id, prototype.thread.id, diff.thread.id]).size,
    ).toBe(4);
    expect(opened).toEqual([
      { threadId: plan.thread.id, panel: "thread" },
      { threadId: reply.thread.id, panel: "thread" },
      { threadId: prototype.thread.id, panel: "thread" },
      { threadId: diff.thread.id, panel: "changes" },
    ]);
  });

  test("revising a diff replaces full file contents used by hunk curation", async () => {
    const controller = new HarnessThreadController(client, {
      surface: { openThreads() {} },
      forge: {
        async importPullRequest() {
          throw new Error("unexpected import");
        },
        async postPullRequestMessage() {
          throw new Error("unexpected post");
        },
      },
      corpus: new LocalRefineCorpusPort(client, home),
    });
    const identity = {
      harness: "fake",
      harnessSessionId: "diff-session",
      workspace: { repoRoot: "/repo", branch: "main" },
      workflow: "diff" as const,
    };
    const first = await controller.openWorkflow({
      ...identity,
      content: "diff --git a/a.ts b/a.ts\n-old\n+first\n",
      files: [{ path: "a.ts", status: "modified", oldContents: "old", newContents: "first" }],
    });
    const second = await controller.openWorkflow({
      ...identity,
      content: "diff --git a/a.ts b/a.ts\n-old\n+second\n",
      files: [{ path: "a.ts", status: "modified", oldContents: "old", newContents: "second" }],
    });

    expect(second.thread.id).toBe(first.thread.id);
    expect(second.thread.artifact.files?.[0]?.newContents).toBe("second");
  });

  test("review imports a PR diff and posts its Message back to the forge", async () => {
    const opened: { threadId: string; panel: string }[] = [];
    const posted: { pr: string; message: Message }[] = [];
    const controller = new HarnessThreadController(client, {
      surface: {
        openThreads(threadId, panel) {
          opened.push({ threadId, panel });
        },
      },
      forge: {
        async importPullRequest(pullRequestReference, cwd) {
          expect(pullRequestReference).toBe("org/repo#42");
          expect(cwd).toBe("/repo");

          return { content: "diff --git a/a.ts b/a.ts\n", title: "PR 42" };
        },
        async postPullRequestMessage(pullRequestReference, message, cwd) {
          expect(cwd).toBe("/repo");
          posted.push({ pr: pullRequestReference, message });
        },
      },
      corpus: {
        async analyzeRefineCorpus() {
          throw new Error("unexpected corpus analysis");
        },
      },
    });
    const review = await controller.openWorkflow({
      harness: "fake",
      harnessSessionId: "fake_1",
      workspace: { repoRoot: "/repo", branch: "main" },
      workflow: "review",
      pullRequestReference: "org/repo#42",
    });
    const received: Message[] = [];
    const harness = new FakeHarness(
      new DeliveredMessageStore(join(home, "review-delivered.json")),
      received,
    );

    expect(review.thread.artifact.type).toBe("diff");
    expect(review.thread.artifact.meta.pr).toBe("org/repo#42");
    expect(opened).toEqual([{ threadId: review.thread.id, panel: "changes" }]);

    core.sessionSendMessage(review.thread.id, "changes_requested", "Add tests.");
    await controller.deliverPending(review.binding.id, harness);

    expect(posted).toEqual([{ pr: "org/repo#42", message: received[0]! }]);
    expect(posted[0]!.message.body).toContain("Add tests.");
  });

  test("refine analyzes the corpus and submits proposals as a plan Thread", async () => {
    const opened: { threadId: string; panel: string }[] = [];
    const controller = new HarnessThreadController(client, {
      surface: {
        openThreads(threadId, panel) {
          opened.push({ threadId, panel });
        },
      },
      forge: {
        async importPullRequest() {
          throw new Error("unexpected forge import");
        },
        async postPullRequestMessage() {
          throw new Error("unexpected forge post");
        },
      },
      corpus: {
        async analyzeRefineCorpus() {
          return { report: "# refine report\n\n- add tests: 3 reviews" };
        },
      },
    });
    const analysis = await controller.analyzeRefineCorpus();
    const result = await controller.openWorkflow({
      harness: "fake",
      harnessSessionId: "fake_1",
      workspace: { repoRoot: "/repo", branch: "main" },
      workflow: "refine",
      proposal: "# Writebacks\n\nAdd regression tests.",
    });

    expect(result.thread.artifact.type).toBe("plan");
    expect(result.thread.artifact.content).toBe("# Writebacks\n\nAdd regression tests.");
    expect(analysis.report).toContain("add tests: 3 reviews");
    expect(opened).toEqual([{ threadId: result.thread.id, panel: "thread" }]);
  });

  test("opens, revises, retries safely, and delivers the approved Message", async () => {
    const controller = new HarnessThreadController(client, {
      surface: { openThreads() {} },
      forge: {
        async importPullRequest() {
          throw new Error("unexpected forge import");
        },
        async postPullRequestMessage() {
          throw new Error("unexpected forge post");
        },
      },
      corpus: {
        async analyzeRefineCorpus() {
          throw new Error("unexpected corpus analysis");
        },
      },
    });
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
