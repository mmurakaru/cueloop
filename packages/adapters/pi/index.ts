/** pi owns lifecycle and message injection; the shared controller owns Threads. */

import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { cueloopHome } from "@cueloop/daemon/paths";
import { WORKFLOW_KINDS, type HarnessBinding, type WorkflowKind } from "@cueloop/schema";
import {
  createHarnessThreadController,
  type HarnessThreadController,
  type HarnessWorkflowRequest,
} from "../harness-thread-controller";
import { createTerminalThreadSurfacePort } from "../terminal-thread-surface-port";
import { createDeliveredMessageStore } from "../delivered-message-store";
import { createGitHubForgeReviewPort } from "../forge-review";
import { createLocalRefineCorpusPort } from "../refine-corpus";
import { wakeMessage } from "../wake-message";
import type { PiContext, PiExtensionAPI, PiToolDefinition, PiToolResult } from "./pi-types";

const OPEN_THREAD_TOOL = "open_thread";
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

export interface OpenThreadParams {
  workflow: WorkflowKind;
  content?: string;
  proposal?: string;
  pullRequestReference?: string;
  title?: string;
}

export interface ThreadDetails {
  sessionId?: string;
  status: "pending" | "resolved" | "cancelled";
  annotationCount: number;
  outcome?: string;
}

export interface CueloopExtensionOptions {
  home?: string;
}

function text(message: string): PiToolResult<ThreadDetails>["content"] {
  return [{ type: "text", text: message }];
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function requestFor(
  params: OpenThreadParams,
  harnessSessionId: string,
  cwd: string,
): HarnessWorkflowRequest {
  const common = { harness: "pi", harnessSessionId, cwd };

  if (params.workflow === "review") {
    if (!params.pullRequestReference) throw new Error("review needs pullRequestReference");

    return { ...common, workflow: "review", pullRequestReference: params.pullRequestReference };
  }
  if (params.workflow === "refine") {
    if (!params.proposal) throw new Error("refine needs proposal from the corpus report");

    return { ...common, workflow: "refine", proposal: params.proposal };
  }
  if (!params.content) throw new Error(`${params.workflow} needs content`);

  return { ...common, workflow: params.workflow, content: params.content, title: params.title };
}

/** Register one in-process extension; pi reload constructs a new instance. */
export function createCueloopExtension(options: CueloopExtensionOptions = {}) {
  const home = options.home ?? cueloopHome();
  const nativeMessages = createDeliveredMessageStore(join(home, "pi-delivered-messages.json"));
  const forgeMessages = createDeliveredMessageStore(join(home, "pi-forge-messages.json"));
  let client: DaemonClient | null = null;
  let controller: HarnessThreadController | null = null;
  let activeSessionId: string | null = null;
  let starting: Promise<void> | null = null;
  let generation = 0;
  const bindings = new Map<string, HarnessBinding>();
  const pendingThreads = new Set<string>();

  return function cueloopExtension(pi: PiExtensionAPI): void {
    async function reconcile(binding: HarnessBinding): Promise<void> {
      if (!client || !controller || binding.harnessSessionId !== activeSessionId) return;
      const thread = await client.sessionGet(binding.threadId);

      if (thread.status === "pending") pendingThreads.add(thread.id);
      else pendingThreads.delete(thread.id);

      await controller.deliverPending(binding.id, {
        sendMessage: (message) =>
          nativeMessages.sendOnce(message, () => {
            if (binding.harnessSessionId !== activeSessionId)
              throw new Error("pi conversation changed before Message injection");
            pi.sendUserMessage(wakeMessage(thread.id, message), { deliverAs: "followUp" });
          }),
      });
    }

    function stop(): void {
      generation += 1;
      client?.close();
      client = null;
      controller = null;
      activeSessionId = null;
      starting = null;
      bindings.clear();
      pendingThreads.clear();
    }

    async function start(context: PiContext): Promise<void> {
      const sessionId = context.sessionManager?.getSessionId();

      if (!sessionId) throw new Error("pi did not provide a conversation ID");
      if (client && activeSessionId === sessionId) return;
      if (starting) return starting;
      stop();
      const currentGeneration = generation;

      starting = (async () => {
        const connected = await DaemonClient.connect({ home, autostart: true });

        if (generation !== currentGeneration) {
          connected.close();

          return;
        }
        try {
          const shared = createHarnessThreadController(connected, {
            surface: createTerminalThreadSurfacePort(connected),
            forge: createGitHubForgeReviewPort(forgeMessages),
            corpus: createLocalRefineCorpusPort(connected, home),
          });

          client = connected;
          controller = shared;
          activeSessionId = sessionId;
          connected.onEvent((event) => {
            if (event.event !== "message.sent" && event.event !== "session.revised") return;
            const binding = [...bindings.values()].find(
              (item) => item.threadId === event.sessionId,
            );

            if (binding) void reconcile(binding).catch(() => {});
          });
          await connected.subscribe();
          const restored = await connected.harnessBindingsForSession("pi", sessionId);

          for (const binding of restored) {
            bindings.set(binding.id, binding);
            await reconcile(binding);
          }
        } catch (error) {
          stop();

          throw error;
        }
      })().finally(() => {
        starting = null;
      });

      return starting;
    }

    const openThread: PiToolDefinition<OpenThreadParams, ThreadDetails> = {
      name: OPEN_THREAD_TOOL,
      label: "Open cueloop Thread",
      description:
        "Open or revise a cueloop Thread for plan, reply, prototype, diff, review, or refine. " +
        "The Thread remains pending until a human sends a Message. For refine, first call refine_corpus.",
      parameters: {
        type: "object",
        properties: {
          workflow: { type: "string", enum: WORKFLOW_KINDS },
          content: { type: "string" },
          proposal: { type: "string" },
          pullRequestReference: { type: "string" },
          title: { type: "string" },
        },
        required: ["workflow"],
      },
      async execute(_toolCallId, params, signal, _onUpdate, context) {
        if (signal?.aborted) {
          return {
            content: text("Thread opening was cancelled."),
            details: { status: "cancelled", annotationCount: 0 },
            isError: true,
          };
        }

        try {
          await start(context);
          const sessionId = activeSessionId;

          if (!controller || !sessionId || !WORKFLOW_KINDS.includes(params.workflow)) {
            throw new Error("pi Thread adapter is not ready");
          }
          const opened = await controller.openWorkflow(requestFor(params, sessionId, context.cwd));

          bindings.set(opened.binding.id, opened.binding);
          if (opened.approvedRetry) {
            return {
              content: text("The unchanged approved plan may proceed."),
              details: {
                sessionId: opened.thread.id,
                status: "resolved",
                annotationCount: opened.thread.annotations.length,
                outcome: opened.thread.message?.outcome,
              },
            };
          }
          pendingThreads.add(opened.thread.id);

          return {
            content: text(
              `Thread ${opened.thread.id} is pending. Do not mutate the workspace until its Message arrives.` +
                (opened.manualOpenCommand ? ` Open it manually: ${opened.manualOpenCommand}` : ""),
            ),
            details: {
              sessionId: opened.thread.id,
              status: "pending",
              annotationCount: opened.thread.annotations.length,
            },
          };
        } catch (error) {
          return {
            content: text(`cueloop could not open a Thread: ${errorMessage(error)}`),
            details: { status: "cancelled", annotationCount: 0 },
            isError: true,
          };
        }
      },
    };

    pi.registerTool(openThread);
    pi.registerTool({
      name: "refine_corpus",
      label: "Analyze cueloop Threads",
      description: "Analyze resolved Threads before drafting a refine proposal.",
      parameters: { type: "object", properties: {} },
      async execute(_toolCallId, _params, _signal, _onUpdate, context) {
        await start(context);
        const report = await controller!.analyzeRefineCorpus();

        return {
          content: text(report.report),
          details: { status: "resolved", annotationCount: 0 },
        };
      },
    });

    pi.on("tool_call", (event) => {
      if (!pendingThreads.size) return undefined;
      if (event.toolName === OPEN_THREAD_TOOL || READ_ONLY_TOOLS.has(event.toolName))
        return undefined;

      return {
        block: true,
        reason: `cueloop Threads pending: ${[...pendingThreads].join(", ")}`,
      };
    });

    pi.on("session_start", async (_event, context) => {
      try {
        await start(context);
      } catch (error) {
        context.ui?.notify?.(`cueloop unavailable: ${errorMessage(error)}`, "error");
      }
    });
    pi.on("session_switch", async (_event, context) => {
      stop();
      await start(context);
    });
    pi.on("session_fork", async (_event, context) => {
      stop();
      await start(context);
    });
    pi.on("session_shutdown", () => stop());

    pi.registerCommand("threads", {
      description: "Show the active cueloop Threads",
      handler: async (_args, context) => {
        await start(context);
        context.ui?.notify?.(
          pendingThreads.size
            ? `Pending Threads: ${[...pendingThreads].join(", ")}`
            : "No pending Threads",
          "info",
        );
      },
    });
  };
}

export default createCueloopExtension();
