/** One-shot bridge from sandboxed harness plugins to the shared Thread controller. */

import { join } from "node:path";
import * as v from "valibot";
import { DaemonClient } from "@cueloop/daemon/client";
import { cueloopHome } from "@cueloop/daemon/paths";
import { WORKFLOW_KINDS, type Message } from "@cueloop/schema";
import {
  createHarnessThreadController,
  type HarnessWorkflowRequest,
} from "./harness-thread-controller";
import { createDeliveredMessageStore } from "./delivered-message-store";
import { createGitHubForgeReviewPort } from "./forge-review";
import { createLocalRefineCorpusPort } from "./refine-corpus";
import { createTerminalThreadSurfacePort } from "./terminal-thread-surface-port";
import { wakeMessage } from "./wake-message";
import { reportLabel, reportState } from "./herdr";

const HarnessNameSchema = v.picklist(["claude-code", "codex"]);
const OpenRequestSchema = v.object({
  operation: v.literal("open"),
  harness: HarnessNameSchema,
  harnessSessionId: v.pipe(v.string(), v.minLength(1)),
  cwd: v.string(),
  workflow: v.picklist(WORKFLOW_KINDS),
  content: v.optional(v.string()),
  proposal: v.optional(v.string()),
  pullRequestReference: v.optional(v.string()),
  title: v.optional(v.string()),
});
const PendingRequestSchema = v.object({
  operation: v.literal("pending"),
  harness: HarnessNameSchema,
  harnessSessionId: v.pipe(v.string(), v.minLength(1)),
});
const AcknowledgeRequestSchema = v.object({
  operation: v.literal("ack"),
  bindingId: v.pipe(v.string(), v.minLength(1)),
  deliveryId: v.pipe(v.string(), v.minLength(1)),
  messageId: v.pipe(v.string(), v.minLength(1)),
});
const RefineRequestSchema = v.object({ operation: v.literal("refine") });
const HarnessBridgeRequestSchema = v.variant("operation", [
  OpenRequestSchema,
  PendingRequestSchema,
  AcknowledgeRequestSchema,
  RefineRequestSchema,
]);

type OpenRequest = v.InferOutput<typeof OpenRequestSchema>;

export interface HarnessBridgeDelivery {
  bindingId: string;
  threadId: string;
  threadStatus: "pending" | "resolved" | "cancelled";
  deliveryId: string;
  message: Message;
  wakeText: string;
}

export type HarnessBridgeResponse =
  | { operation: "open"; threadId: string; approvedRetry: boolean; manualOpenCommand?: string }
  | { operation: "pending"; deliveries: HarnessBridgeDelivery[]; pendingThreadIds: string[] }
  | { operation: "ack"; deliveryId: string }
  | { operation: "refine"; report: string };

function workflowRequest(input: OpenRequest): HarnessWorkflowRequest {
  const common = {
    harness: input.harness,
    harnessSessionId: input.harnessSessionId,
    cwd: input.cwd,
  };

  if (input.workflow === "review") {
    if (!input.pullRequestReference)
      throw new Error("Harness bridge review needs pullRequestReference");

    return { ...common, workflow: "review", pullRequestReference: input.pullRequestReference };
  }
  if (input.workflow === "refine") {
    if (!input.proposal) throw new Error("Harness bridge refine needs proposal");

    return { ...common, workflow: "refine", proposal: input.proposal };
  }
  if (!input.content) throw new Error(`Harness bridge ${input.workflow} needs content`);

  return { ...common, workflow: input.workflow, content: input.content, title: input.title };
}

/** Execute one validated controller operation without giving a plugin daemon ownership. */
export async function runHarnessBridge(
  rawRequest: v.InferInput<typeof HarnessBridgeRequestSchema>,
  home = cueloopHome(),
): Promise<HarnessBridgeResponse> {
  const request = v.parse(HarnessBridgeRequestSchema, rawRequest);

  const client = await DaemonClient.connect({ home, autostart: true });

  try {
    const forge = createGitHubForgeReviewPort(
      createDeliveredMessageStore(join(home, "harness-forge-messages.json")),
    );
    const controller = createHarnessThreadController(client, {
      surface: createTerminalThreadSurfacePort(client),
      forge,
      corpus: createLocalRefineCorpusPort(client, home),
    });

    if (request.operation === "open") {
      const opened = await controller.openWorkflow(workflowRequest(request));

      if (request.harness === "claude-code" && !opened.approvedRetry) {
        reportState("blocked");
        reportLabel(
          `${opened.workflow} ready for review: ${opened.thread.artifact.meta.title ?? opened.thread.id}`,
        );
      }

      return {
        operation: "open",
        threadId: opened.thread.id,
        approvedRetry: opened.approvedRetry,
        manualOpenCommand: opened.manualOpenCommand,
      };
    }
    if (request.operation === "refine") {
      const report = await controller.analyzeRefineCorpus();

      return { operation: "refine", report: report.report };
    }
    if (request.operation === "pending") {
      const bindings = await client.harnessBindingsForSession(
        request.harness,
        request.harnessSessionId,
      );
      const deliveries: HarnessBridgeDelivery[] = [];
      const pendingThreadIds: string[] = [];

      for (const binding of bindings) {
        const thread = await client.sessionGet(binding.threadId);

        if (thread.status === "pending") pendingThreadIds.push(thread.id);
        for (const item of await client.deliveryPending(binding.id)) {
          deliveries.push({
            bindingId: binding.id,
            threadId: thread.id,
            threadStatus: thread.status,
            deliveryId: item.delivery.id,
            message: item.message,
            wakeText: wakeMessage(thread.id, item.message),
          });
        }
      }

      return { operation: "pending", deliveries, pendingThreadIds };
    }
    const binding = await client.harnessGetBinding(request.bindingId);
    const pending = await client.deliveryPending(binding.id);
    const delivery = pending.find((item) => item.delivery.id === request.deliveryId);

    if (!delivery || delivery.message.id !== request.messageId)
      throw new Error("Harness bridge acknowledgement does not match a pending Message");
    const thread = await client.sessionGet(binding.threadId);

    if (thread.artifact.meta.pr) {
      await forge.postPullRequestMessage(
        thread.artifact.meta.pr,
        delivery.message,
        thread.artifact.meta.cwd ?? thread.workspace.repoRoot,
      );
    }
    await client.deliveryAcknowledge(delivery.delivery.id);
    if (binding.harness === "claude-code") {
      reportState("working");
      reportLabel(`review done: ${delivery.message.outcome}`);
    }

    return { operation: "ack", deliveryId: delivery.delivery.id };
  } finally {
    client.close();
  }
}
