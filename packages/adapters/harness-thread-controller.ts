/**
 * Harness-neutral orchestration for a plan Thread. An adapter supplies stable
 * harness identity and one native sendMessage implementation; cueloop owns the
 * open-or-revise lifecycle, durable routing, acknowledgement, and retry loop.
 */

import type {
  Delivery,
  HarnessBinding,
  Message,
  PendingDelivery,
  Thread,
  WorkspaceKey,
} from "@cueloop/schema";
import {
  findExistingReview,
  openReview,
  type ThreadSessionClient,
} from "@cueloop/daemon/thread-review";

/** Thread operations required by the shared harness controller. */
export interface HarnessThreadClient extends ThreadSessionClient {
  harnessBind(threadId: string, harness: string, harnessSessionId: string): Promise<HarnessBinding>;
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

export interface BoundThread {
  binding: HarnessBinding;
  thread: Thread;
  /** True only for the one unchanged resubmission permitted by an approval. */
  approvedRetry: boolean;
}

/** Opens plan Threads and delivers Messages for any harness adapter. */
export class HarnessThreadController {
  constructor(private readonly client: HarnessThreadClient) {}

  /** Open the first plan Thread or revise the one already bound to this harness session. */
  async openPlanThread(input: OpenPlanThreadInput): Promise<BoundThread> {
    const options = {
      type: "plan",
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
    const pending = await this.client.deliveryPending(bindingId);

    for (const item of pending) {
      await adapter.sendMessage(item.message);
      await this.client.deliveryAcknowledge(item.delivery.id);
    }

    return pending.length;
  }
}
