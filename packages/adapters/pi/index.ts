/**
 * pi adapter (#13): a pi extension factory. Registers the request_review
 * tool (submit a plan, block on the cueloop verdict), a tool_call gate that
 * holds write-capable tools while a review this extension opened is still
 * pending, and a /review command that reports session status.
 */

import { DaemonClient } from "@cueloop/daemon/client";
import { verdictAllows, type ReviewSession } from "@cueloop/schema";
import { resolveWorkspaceForHook } from "../claude-code/workspace";
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

/** Sentinel distinguishing an abort from any daemon response. */
const ABORTED = Symbol("aborted");

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.resolve(ABORTED);
  }
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = () => {
      // The daemon request keeps running until the client closes; swallow its
      // eventual rejection so the abort path never leaks an unhandled error.
      promise.catch(() => {});
      resolve(ABORTED);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

const text = (t: string): PiToolResult<ReviewDetails>["content"] => [{ type: "text", text: t }];

function cancelledResult(sessionId: string | undefined, annotationCount: number): PiToolResult<ReviewDetails> {
  const suffix = sessionId ? ` Session ${sessionId} stays pending; the verdict is collectable later.` : "";
  return {
    content: text(`cueloop review cancelled.${suffix}`),
    details: { sessionId, status: "cancelled", annotationCount },
    isError: true,
  };
}

function firstHeading(md: string): string | undefined {
  const m = md.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim();
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
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) return cancelledResult(undefined, 0);
      const client = await DaemonClient.connect({ home: options.home, autostart: true });
      let sessionId: string | undefined;
      try {
        const workspace = await resolveWorkspaceForHook(ctx.cwd);
        const session = await client.sessionCreate(workspace, {
          type: "plan",
          content: params.plan,
          meta: { agent: "pi", title: params.title ?? firstHeading(params.plan), cwd: ctx.cwd },
        });
        sessionId = session.id;
        lastSessionId = session.id;
        pendingSessions.add(session.id);

        let reportedCount = -1;
        const report = (s: ReviewSession) => {
          if (s.annotations.length === reportedCount) return;
          reportedCount = s.annotations.length;
          onUpdate?.({
            content: text(`cueloop review ${s.id} pending - ${s.annotations.length} annotation(s) so far`),
            details: { sessionId: s.id, status: "pending", annotationCount: s.annotations.length },
          });
        };
        report(session);

        for (;;) {
          const resolved = await raceAbort(client.sessionWait(session.id, pollMs), signal);
          if (resolved === ABORTED) return cancelledResult(sessionId, Math.max(reportedCount, 0));
          if (resolved !== null) {
            const verdict = resolved.verdict!;
            const details: ReviewDetails = {
              sessionId: session.id,
              status: "resolved",
              annotationCount: resolved.annotations.length,
              verdictKind: verdict.kind,
            };
            if (verdictAllows(verdict.kind)) return { content: text(verdict.feedback), details };
            return { content: text(verdict.feedback), details, isError: true };
          }
          // Still pending after this chunk: re-read to surface reviewer progress.
          const current = await raceAbort(client.sessionGet(session.id), signal);
          if (current === ABORTED) return cancelledResult(sessionId, Math.max(reportedCount, 0));
          report(current);
        }
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
      handler: async (_args, ctx) => {
        const notify = (message: string) => ctx.ui?.notify?.(message, "info");
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
          const s = await client.sessionGet(lastSessionId);
          notify(
            s.status === "pending"
              ? `cueloop review ${s.id} pending - ${s.annotations.length} annotation(s)`
              : `cueloop review ${s.id} resolved: ${s.verdict?.kind ?? "unknown"}`,
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
