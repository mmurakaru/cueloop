/**
 * Harness-neutral orchestration for six Thread workflows. An adapter supplies
 * stable harness identity and native sendMessage; cueloop owns open-or-revise,
 * durable routing, acknowledgement, and retry.
 */

import type {
  Delivery,
  HarnessBinding,
  Message,
  PendingDelivery,
  DiffFileContents,
  Thread,
  WorkspaceKey,
  ThreadSurfaceOpenStatus,
} from "@cueloop/schema";
import { manualThreadOpenCommand } from "@cueloop/schema";
import {
  findExistingReview,
  openReview,
  type ThreadSessionClient,
} from "@cueloop/daemon/thread-review";

/** Thread operations required by the shared harness controller. */
export interface HarnessThreadClient extends ThreadSessionClient {
  harnessBind(threadId: string, harness: string, harnessSessionId: string): Promise<HarnessBinding>;
  harnessGetBinding(bindingId: string): Promise<HarnessBinding>;
  harnessConsumeApprovedRetry(
    bindingId: string,
    messageId: string,
    content: string,
  ): Promise<boolean>;
  deliveryPending(bindingId: string): Promise<PendingDelivery[]>;
  deliveryAcknowledge(deliveryId: string): Promise<Delivery>;
}

export interface HarnessMessageAdapter {
  /** Must ignore a Message id it has already injected successfully. */
  sendMessage(message: Message): void | Promise<void>;
}

export interface OpenPlanThreadInput {
  harness: string;
  harnessSessionId: string;
  content: string;
  cwd?: string;
  workspace?: WorkspaceKey;
}

/** Which built-in cueloop panel an opened Thread uses. */
export type ThreadPanel = "thread" | "changes";

/** Terminal integration port; the harness never renders its own review UI. */
export interface ThreadSurfacePort {
  openThreads(
    threadId: string,
    panel: ThreadPanel,
    thread: Thread,
  ): ThreadSurfaceOpenStatus | void | Promise<ThreadSurfaceOpenStatus | void>;
}

/** Forge operations shared by every harness's PR review workflow. */
export interface ForgeReviewPort {
  importPullRequest(
    pullRequestReference: string,
    cwd?: string,
  ): Promise<{ content: string; title?: string }>;
  /** Must ignore a Message ID already posted to this PR. */
  postPullRequestMessage(
    pullRequestReference: string,
    message: Message,
    cwd?: string,
  ): void | Promise<void>;
}

/** Corpus analysis shared by every harness's refine workflow. */
export interface RefineCorpusPort {
  analyzeRefineCorpus(): Promise<{ report: string }>;
}

/** Platform-neutral services used by the six shared workflows. */
export interface HarnessWorkflowPorts {
  surface: ThreadSurfacePort;
  forge: ForgeReviewPort;
  corpus: RefineCorpusPort;
}

/** Artifact workflow request; review and refine have separate request variants. */
export type ArtifactWorkflowRequest = OpenPlanThreadInput & {
  workflow: "plan" | "reply" | "prototype" | "diff";
  title?: string;
  files?: DiffFileContents[];
};

/** A pull request imported into a diff Thread. */
export type ReviewWorkflowRequest = Omit<OpenPlanThreadInput, "content"> & {
  workflow: "review";
  pullRequestReference: string;
};

/** A corpus-backed writeback proposal submitted as a plan Thread. */
export type RefineWorkflowRequest = Omit<OpenPlanThreadInput, "content"> & {
  workflow: "refine";
  proposal: string;
};

/** One of the six harness-neutral review workflows. */
export type HarnessWorkflowRequest =
  | ArtifactWorkflowRequest
  | ReviewWorkflowRequest
  | RefineWorkflowRequest;

/** The Thread and built-in panel returned for a workflow. */
export type OpenedWorkflow = BoundThread & {
  workflow: HarnessWorkflowRequest["workflow"];
  panel: ThreadPanel;
  /** Manual fallback when terminal automation fails; the Thread remains pending. */
  manualOpenCommand?: string;
};

export interface BoundThread {
  binding: HarnessBinding;
  thread: Thread;
  /** True only for the one unchanged resubmission permitted by an approval. */
  approvedRetry: boolean;
}

/** Opens plan Threads and delivers Messages for any harness adapter. */
export class HarnessThreadController {
  constructor(
    private readonly client: HarnessThreadClient,
    private readonly ports: HarnessWorkflowPorts,
  ) {}

  /** Analyze first; the harness drafts writebacks from this report before submitting refine. */
  analyzeRefineCorpus(): Promise<{ report: string }> {
    return this.ports.corpus.analyzeRefineCorpus();
  }

  /** Open any workflow through the same Thread lifecycle and built-in panels. */
  async openWorkflow(input: HarnessWorkflowRequest): Promise<OpenedWorkflow> {
    if (input.workflow === "review") {
      const cwd = input.cwd ?? input.workspace?.repoRoot;
      const imported = await this.ports.forge.importPullRequest(input.pullRequestReference, cwd);
      const review = await openReview(this.client, {
        type: "diff",
        workflow: "review",
        content: imported.content,
        title: imported.title ?? `PR ${input.pullRequestReference}`,
        pr: input.pullRequestReference,
        cwd,
        workspace: input.workspace,
        agent: input.harness,
        agentSessionId: input.harnessSessionId,
      });
      const binding = await this.client.harnessBind(
        review.id,
        input.harness,
        input.harnessSessionId,
      );

      const manualOpenCommand = await this.openThreadSurface(review.session, "changes");

      return {
        binding,
        thread: review.session,
        approvedRetry: false,
        workflow: "review",
        panel: "changes",
        manualOpenCommand,
      };
    }
    if (input.workflow === "refine") {
      const review = await openReview(this.client, {
        type: "plan",
        workflow: "refine",
        content: input.proposal,
        cwd: input.cwd,
        workspace: input.workspace,
        agent: input.harness,
        agentSessionId: input.harnessSessionId,
      });
      const binding = await this.client.harnessBind(
        review.id,
        input.harness,
        input.harnessSessionId,
      );

      const manualOpenCommand = await this.openThreadSurface(review.session, "thread");

      return {
        binding,
        thread: review.session,
        approvedRetry: false,
        workflow: "refine",
        panel: "thread",
        manualOpenCommand,
      };
    }

    const panel: ThreadPanel = input.workflow === "diff" ? "changes" : "thread";
    const bound =
      input.workflow === "plan"
        ? await this.openPlanThread(input)
        : await this.openArtifactWorkflow(input);

    const manualOpenCommand = await this.openThreadSurface(bound.thread, panel);

    return { ...bound, workflow: input.workflow, panel, manualOpenCommand };
  }

  private async openThreadSurface(thread: Thread, panel: ThreadPanel): Promise<string | undefined> {
    try {
      const result = await this.ports.surface.openThreads(thread.id, panel, thread);

      return result === "failed" || result === "unavailable" || result === "disabled"
        ? manualThreadOpenCommand(thread.id)
        : undefined;
    } catch {
      return manualThreadOpenCommand(thread.id);
    }
  }

  private async openArtifactWorkflow(input: ArtifactWorkflowRequest): Promise<BoundThread> {
    const review = await openReview(this.client, {
      type: input.workflow,
      workflow: input.workflow,
      content: input.content,
      cwd: input.cwd,
      workspace: input.workspace,
      agent: input.harness,
      agentSessionId: input.harnessSessionId,
      title: input.title,
      files: input.files,
    });
    const binding = await this.client.harnessBind(review.id, input.harness, input.harnessSessionId);

    return { binding, thread: review.session, approvedRetry: false };
  }

  /** Open the first plan Thread or revise the one already bound to this harness session. */
  async openPlanThread(input: OpenPlanThreadInput): Promise<BoundThread> {
    const options = {
      type: "plan",
      workflow: "plan",
      content: input.content,
      cwd: input.cwd,
      workspace: input.workspace,
      agent: input.harness,
      agentSessionId: input.harnessSessionId,
    } as const;
    const existing = await findExistingReview(this.client, options);

    if (
      existing?.status === "resolved" &&
      existing.message?.outcome === "approved" &&
      existing.artifact.content === input.content
    ) {
      const binding = await this.client.harnessBind(
        existing.id,
        input.harness,
        input.harnessSessionId,
      );
      const approvedRetry = await this.client.harnessConsumeApprovedRetry(
        binding.id,
        existing.message.id,
        input.content,
      );

      if (approvedRetry) return { binding, thread: existing, approvedRetry: true };
    }

    const review = await openReview(this.client, options);
    const binding = await this.client.harnessBind(review.id, input.harness, input.harnessSessionId);

    return { binding, thread: review.session, approvedRetry: false };
  }

  /** Deliver every pending Message in order, acknowledging only after native injection succeeds. */
  async deliverPending(bindingId: string, adapter: HarnessMessageAdapter): Promise<number> {
    const binding = await this.client.harnessGetBinding(bindingId);
    const thread = await this.client.sessionGet(binding.threadId);
    const pending = await this.client.deliveryPending(bindingId);

    for (const item of pending) {
      if (thread.artifact.meta.pr) {
        await this.ports.forge.postPullRequestMessage(
          thread.artifact.meta.pr,
          item.message,
          thread.artifact.meta.cwd ?? thread.workspace.repoRoot,
        );
      }

      await adapter.sendMessage(item.message);
      await this.client.deliveryAcknowledge(item.delivery.id);
    }

    return pending.length;
  }
}
