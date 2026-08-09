/**
 * pi adapter: a pi extension factory. Registers the request_review
 * tool (submit a plan, block on the cueloop verdict), a tool_call gate that
 * holds write-capable tools while a review this extension opened is still
 * pending, and a /review command that reports session status.
 */

import { DaemonClient } from "@cueloop/daemon/client";
import { openReview } from "@cueloop/daemon/review";
import type { ReviewSession } from "@cueloop/schema";
import type {
  PiContext,
  PiExtensionAPI,
  PiToolDefinition,
  PiToolResult,
} from "./pi-types";

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
  /** Long-poll chunk length; between chunks the session is re-read to report progress. */
  pollMs?: number;
}

const text = (message: string): PiToolResult<ReviewDetails>["content"] => [{ type: "text", text: message }];

function cancelledResult(sessionId: string | undefined, annotationCount: number): PiToolResult<ReviewDetails> {
  const suffix = sessionId ? ` Session ${sessionId} stays pending; the verdict is collectable later.` : "";
  return {
    content: text(`cueloop review cancelled.${suffix}`),
    details: { sessionId, status: "cancelled", annotationCount },
    isError: true,
  };
}

export function createCueloopExtension(options: CueloopExtensionOptions = {}) {
  const pollMs = options.pollMs ?? 10_000;
  /** Session ids this extension created and is still blocking on. */
  const pendingSessions = new Set<string>();
  /** Most recent session this extension created, for /review. */
  let lastSessionId: string | undefined;

  const requestReview: PiToolDefinition<RequestReviewParams, ReviewDetails> = {
    name: REVIEW_TOOL,
    label: "Request review",
    description:
      "Submit a plan for human review in cueloop and block until the reviewer returns a verdict. " +
      "An approve verdict returns the reviewer's feedback; any other verdict is an error result " +
      "carrying structured feedback that must be addressed before proceeding.",
    parameters: {
      type: "object",
      properties: {
        plan: { type: "string", description: "The full plan as markdown." },
        title: { type: "string", description: "Session title; defaults to the plan's first heading." },
      },
      required: ["plan"],
    },
    async execute(_toolCallId, params, signal, onUpdate, context) {
      if (signal?.aborted) return cancelledResult(undefined, 0);
      const client = await DaemonClient.connect({ home: options.home, autostart: true });
      let sessionId: string | undefined;
      try {
        const review = await openReview(client, {
          type: "plan",
          content: params.plan,
          cwd: context.cwd,
          agent: "pi",
          title: params.title,
        });
        sessionId = review.id;
        lastSessionId = review.id;
        pendingSessions.add(review.id);

        let reportedCount = -1;
        const report = (progress: ReviewSession) => {
          if (progress.annotations.length === reportedCount) return;
          reportedCount = progress.annotations.length;
          onUpdate?.({
            content: text(`cueloop review ${progress.id} pending - ${progress.annotations.length} annotation(s) so far`),
            details: { sessionId: progress.id, status: "pending", annotationCount: progress.annotations.length },
          });
        };
        report(review.session);

        // No total budget: the loop runs until the verdict lands or the host
        // aborts, and only an abort surfaces as "pending" here.
        const verdict = await review.awaitVerdict({
          timeoutMs: Infinity,
          pollMs,
          onProgress: report,
          signal,
        });
        if (verdict === "pending") return cancelledResult(sessionId, Math.max(reportedCount, 0));
        const details: ReviewDetails = {
          sessionId: review.id,
          status: "resolved",
          annotationCount: verdict.session.annotations.length,
          verdictKind: verdict.session.verdict!.kind,
        };
        if (verdict.allow) return { content: text(verdict.feedback), details };
        return { content: text(verdict.feedback), details, isError: true };
      } finally {
        if (sessionId !== undefined) pendingSessions.delete(sessionId);
        client.close();
      }
    },
  };

  return function cueloopExtension(pi: PiExtensionAPI): void {
    pi.registerTool(requestReview);

    pi.on("tool_call", (event) => {
      if (pendingSessions.size === 0) return undefined;
      if (event.toolName === REVIEW_TOOL || READ_ONLY_TOOLS.has(event.toolName)) return undefined;
      const ids = [...pendingSessions].join(", ");
      return { block: true, reason: `cueloop review pending (session ${ids}) - wait for the verdict before writing` };
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
