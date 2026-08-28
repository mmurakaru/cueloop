/**
 * pi adapter: a pi extension factory. Registers the request_review tool
 * (submit a plan, return immediately with the session id), a background waiter
 * per open review that injects the reviewer's verdict back into the live session
 * with pi.sendUserMessage once it resolves, a tool_call gate that holds
 * write-capable tools while a review this extension opened is still pending, and
 * a /review command that reports session status.
 *
 * Non-blocking by design (ADR 0008): the tool call does not sit inside the
 * verdict wait, so the human keeps chatting with the agent while the plan is
 * open. Each review spawns a detached waiter that parks on awaitResolve and
 * wakes the turn with a followUp message; session_shutdown aborts any waiter
 * still parked so a closed pi session never injects into a dead turn.
 */

import { DaemonClient } from "@cueloop/daemon/client";
import { awaitResolve, openReview } from "@cueloop/daemon/review";
import { wakeMessage } from "../wake-message";
import type { PiExtensionAPI, PiToolDefinition, PiToolResult } from "./pi-types";

const REVIEW_TOOL = "request_review";

/**
 * Conservative allowlist: only tools that cannot mutate the workspace pass
 * while a review is pending. Everything else (edit, write, bash, unknown
 * custom tools) is blocked.
 */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

export interface RequestReviewParams {
  plan: string;
  title?: string;
}

export interface ReviewDetails {
  sessionId?: string;
  status: "pending" | "resolved" | "cancelled";
  annotationCount: number;
  verdictKind?: string;
}

export interface CueloopExtensionOptions {
  /** State-dir override; the default resolves CUELOOP_HOME from the environment. */
  home?: string;
  /** Long-poll chunk length for the background waiter's awaitResolve loop. */
  pollMs?: number;
}

const text = (message: string): PiToolResult<ReviewDetails>["content"] => [
  { type: "text", text: message },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCueloopExtension(options: CueloopExtensionOptions = {}) {
  const pollMs = options.pollMs ?? 10_000;
  /** Session ids this extension opened whose verdict is still outstanding, each with its waiter's abort. */
  const pendingWaiters = new Map<string, AbortController>();
  /** Most recent session this extension created, for /review. */
  let lastSessionId: string | undefined;

  /**
   * The detached waiter: park on the verdict, then wake the live pi turn with a
   * followUp message. Owns the daemon connection for the whole wait, so the held
   * connection also keeps the daemon off its idle-exit path. Never throws into
   * the background: a dropped daemon or a vanished session is reported to the
   * turn once, not left to crash the session.
   */
  async function wakeOnResolve(
    pi: PiExtensionAPI,
    client: DaemonClient,
    sessionId: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      const verdict = await awaitResolve(client, sessionId, { pollMs, signal: controller.signal });

      // A verdict can win the race with a shutdown abort; recheck before injecting
      // so a follow-up never lands in a pi session that has already torn down.
      if (verdict === null || controller.signal.aborted) return;
      pi.sendUserMessage(wakeMessage(sessionId, verdict), { deliverAs: "followUp" });
    } catch (error) {
      if (controller.signal.aborted) return;
      pi.sendUserMessage(
        `cueloop could not collect the verdict for review ${sessionId}: ${errorMessage(error)}`,
        { deliverAs: "followUp" },
      );
    } finally {
      pendingWaiters.delete(sessionId);
      client.close();
    }
  }

  const requestReview: PiToolDefinition<RequestReviewParams, ReviewDetails> = {
    name: REVIEW_TOOL,
    label: "Request review",
    description:
      "Submit a plan for human review in cueloop and return immediately with the session id. " +
      "Do not block: end your turn and keep helping the user. When the reviewer returns a verdict " +
      "cueloop wakes this session with a follow-up message carrying the outcome - an approval to " +
      "proceed, or structured feedback to address before continuing.",
    parameters: {
      type: "object",
      properties: {
        plan: { type: "string", description: "The full plan as markdown." },
        title: {
          type: "string",
          description: "Session title; defaults to the plan's first heading.",
        },
      },
      required: ["plan"],
    },
    async execute(_toolCallId, params, signal, _onUpdate, context) {
      if (signal?.aborted) {
        return {
          content: text("cueloop review cancelled before it opened."),
          details: { status: "cancelled", annotationCount: 0 },
          isError: true,
        };
      }
      const client = await DaemonClient.connect({ home: options.home, autostart: true });

      try {
        const review = await openReview(client, {
          type: "plan",
          content: params.plan,
          cwd: context.cwd,
          agent: "pi",
          title: params.title,
        });

        lastSessionId = review.id;
        const controller = new AbortController();

        pendingWaiters.set(review.id, controller);
        // A host abort of this (already-returned) call still tears the waiter down,
        // releasing the write gate and connection instead of leaking a live wait.
        signal?.addEventListener("abort", () => controller.abort(), { once: true });
        // Hand the connection to the waiter; it closes the client when done.
        void wakeOnResolve(pi, client, review.id, controller);

        return {
          content: text(
            `cueloop review opened (session ${review.id}). Keep working; I will deliver the ` +
              `reviewer's verdict as a follow-up when it lands.`,
          ),
          details: { sessionId: review.id, status: "pending", annotationCount: 0 },
        };
      } catch (error) {
        client.close();

        return {
          content: text(`cueloop could not open the review: ${errorMessage(error)}`),
          details: { status: "cancelled", annotationCount: 0 },
          isError: true,
        };
      }
    },
  };

  let pi: PiExtensionAPI;

  return function cueloopExtension(api: PiExtensionAPI): void {
    pi = api;
    pi.registerTool(requestReview);

    pi.on("tool_call", (event) => {
      if (pendingWaiters.size === 0) return undefined;
      if (event.toolName === REVIEW_TOOL || READ_ONLY_TOOLS.has(event.toolName)) return undefined;
      const ids = [...pendingWaiters.keys()].join(", ");

      return {
        block: true,
        reason: `cueloop review pending (session ${ids}) - wait for the verdict before writing`,
      };
    });

    pi.on("session_shutdown", () => {
      for (const controller of pendingWaiters.values()) controller.abort();
    });

    pi.registerCommand("review", {
      description: "Show the status of the current cueloop review session",
      handler: async (_args, context) => {
        const notify = (message: string) => context.ui?.notify?.(message, "info");
        let client: DaemonClient;

        try {
          client = await DaemonClient.connect({ home: options.home });
        } catch {
          notify("cueloop daemon is not running - no active reviews");

          return;
        }
        try {
          if (lastSessionId === undefined) {
            const pending = await client.sessionList({ status: "pending" });

            notify(
              pending.length > 0
                ? `no review opened from this session; ${pending.length} cueloop session(s) pending overall`
                : "no cueloop review sessions",
            );

            return;
          }
          const session = await client.sessionGet(lastSessionId);

          notify(
            session.status === "pending"
              ? `cueloop review ${session.id} pending - ${session.annotations.length} annotation(s)`
              : `cueloop review ${session.id} resolved: ${session.verdict?.kind ?? "unknown"}`,
          );
        } finally {
          client.close();
        }
      },
    });
  };
}

/** Default factory pi loads; state dir and poll cadence come from the environment. */
export default createCueloopExtension();
