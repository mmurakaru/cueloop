#!/usr/bin/env bun
/**
 * Claude Code adapter: the ExitPlanMode plan gate, non-blocking (ADR 0008).
 * Instead of freezing the turn inside the tool call until the reviewer decides,
 * the hook opens the review, arms a detached inbox waiter, and denies the exit
 * right away - so the agent ends its turn and the human keeps chatting. When the
 * reviewer submits, the waiter injects the verdict into the live session over
 * the inbox socket. The agent then presents the plan again: an approved plan
 * whose content matches the verdict is allowed through; anything else (a pending
 * review, or one that came back with changes) opens a fresh review round.
 *
 * Wire into ~/.claude/settings.json:
 *   { "hooks": { "PermissionRequest": [ { "matcher": "ExitPlanMode",
 *       "hooks": [{ "type": "command", "command": "bun run .../hook.ts" }] } ] } }
 * (PreToolUse works identically for headless runs.)
 */

import { DaemonClient } from "@cueloop/daemon/client";
import { openHerdrPaneForReview } from "@cueloop/daemon/herdr-pane";
import { openReview } from "@cueloop/daemon/review";
import { verdictAllows } from "@cueloop/schema";
import { reportLabel, reportState } from "../herdr";

interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { plan?: string };
}

interface HookDecision {
  allow: boolean;
  reason: string;
}

/**
 * Arm the detached inbox waiter that resumes this Claude Code session when the
 * verdict lands. A child of the hook (itself a child of the session) inherits
 * the inbox socket env, and unref lets the hook exit while the waiter parks.
 */
function spawnDetachedWake(sessionId: string, home?: string): void {
  const entry = new URL("./wake.ts", import.meta.url).pathname;

  Bun.spawn([process.execPath, "run", entry, sessionId], {
    env: home === undefined ? process.env : { ...process.env, CUELOOP_HOME: home },
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}

export interface RunHookOptions {
  home?: string;
  /** Arm the wake; injectable so tests do not spawn a real waiter process. */
  armWake?: (sessionId: string, home?: string) => void;
}

export async function runHook(
  event: HookEvent,
  options: RunHookOptions = {},
): Promise<HookDecision> {
  const plan = event.tool_input?.plan;

  if (!plan) return { allow: true, reason: "no plan payload - not a plan gate" };
  const armWake = options.armWake ?? spawnDetachedWake;

  const client = await DaemonClient.connect({ home: options.home, autostart: true });

  try {
    // Second pass: this exact plan already came back approved, so let the agent
    // exit plan mode and proceed. Any other state falls through to a review round.
    const existing = event.session_id
      ? (await client.sessionList()).find(
          (candidate) => candidate.artifact.meta.agentSessionId === event.session_id,
        )
      : undefined;

    if (
      existing?.status === "resolved" &&
      existing.verdict !== null &&
      verdictAllows(existing.verdict.kind) &&
      existing.artifact.content === plan
    ) {
      reportState("working");
      reportLabel(`review done: ${existing.verdict.kind}`);

      return { allow: true, reason: existing.verdict.feedback };
    }

    // First pass (or a revised plan): open-or-revise the review by agent session,
    // arm the wake, and deny now so the agent ends its turn instead of blocking.
    const review = await openReview(client, {
      type: "plan",
      content: plan,
      cwd: event.cwd,
      agent: "claude-code",
      agentSessionId: event.session_id,
      // first-class herdr: the review knows which pane to return to
      herdrPane: process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined,
    });

    // herdr auto-open: render the review in a tab, reopening only if the recorded
    // one is gone. No-op outside herdr.
    await openHerdrPaneForReview(review.session, client);
    // herdr tier 1: the pane shows blocked + "plan ready for review" while the
    // reviewer works; no-ops outside herdr.
    reportState("blocked");
    reportLabel(`plan ready for review: ${review.session.artifact.meta.title ?? review.id}`);

    armWake(review.id, options.home);

    return {
      allow: false,
      reason:
        `cueloop review ${review.id} opened for human review. Do not proceed and do not wait - ` +
        `end your turn and keep helping the user. cueloop delivers the reviewer's verdict to this ` +
        `session as a follow-up: on approval, present this same plan again to proceed; on changes, ` +
        `apply the feedback and present the revised plan.`,
    };
  } finally {
    client.close();
  }
}

/** Serialize the decision in the event's native shape. */
export function hookOutput(event: HookEvent, decision: HookDecision): unknown {
  if (event.hook_event_name === "PreToolUse") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.allow ? "allow" : "deny",
        permissionDecisionReason: decision.reason,
      },
    };
  }

  // PermissionRequest shape. The decision MUST be wrapped in hookSpecificOutput
  // with hookEventName; a bare top-level `decision` is not recognized, so Claude
  // Code falls through to its native plan-approval dialog and the human approves
  // twice. Wrapped, cueloop is the sole gate and the native dialog is suppressed.
  // A bare allow exits plan mode in the default mode (no auto-accept prompt).
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: decision.allow
        ? { behavior: "allow" }
        : { behavior: "deny", message: decision.reason },
    },
  };
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  let event: HookEvent = {};

  try {
    event = JSON.parse(raw) as HookEvent;
  } catch {
    // no payload: allow rather than wedge the agent on adapter failure
    console.log(
      JSON.stringify(hookOutput({}, { allow: true, reason: "unparseable hook payload" })),
    );
    process.exit(0);
  }
  // An adapter failure must never wedge the agent: emit a valid hook response
  // carrying the reason instead of dying silently (a crash gives the agent no
  // stdout at all, which reads as a broken gate rather than a skipped review).
  let decision: HookDecision;

  try {
    decision = await runHook(event);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    decision = { allow: true, reason: `cueloop unavailable, review skipped: ${reason}` };
    console.error(`cueloop hook error: ${reason}`);
  }
  console.log(JSON.stringify(hookOutput(event, decision)));
  process.exit(0);
}
