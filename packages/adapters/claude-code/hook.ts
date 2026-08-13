#!/usr/bin/env bun
/**
 * Claude Code adapter: intercept the plan gate, block on the
 * cueloop verdict, answer in the hook's native contract.
 *
 * Wire into ~/.claude/settings.json:
 *   { "hooks": { "PermissionRequest": [ { "matcher": "ExitPlanMode",
 *       "hooks": [{ "type": "command", "command": "bun run .../hook.ts", "timeout": 600 }] } ] } }
 * (PreToolUse works identically for headless runs.)
 *
 * The wait contract: if the hook's window closes before the reviewer
 * finishes, the answer is a denial-shaped "review pending" and the stored
 * verdict is delivered when the agent retries - a review is never lost.
 */

import { DaemonClient } from "@cueloop/daemon/client";
import { openHerdrPaneForReview } from "@cueloop/daemon/herdr-pane";
import { openReview } from "@cueloop/daemon/review";
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

export async function runHook(event: HookEvent, home?: string): Promise<HookDecision> {
  const plan = event.tool_input?.plan;
  if (!plan) return { allow: true, reason: "no plan payload - not a plan gate" };

  const client = await DaemonClient.connect({ home, autostart: true });
  try {
    // The core opens-or-revises by agentSessionId and derives the title.
    const review = await openReview(client, {
      type: "plan",
      content: plan,
      cwd: event.cwd,
      agent: "claude-code",
      agentSessionId: event.session_id,
      // first-class herdr: the review knows which pane to return to
      herdrPane: process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined,
    });

    // herdr auto-open: a review created from inside herdr spawns a new tab
    // that renders it, so the human does not run a command by hand. Guarded to
    // genuinely new sessions and no-op outside herdr.
    openHerdrPaneForReview(review.session);

    // herdr tier 1: the pane shows blocked + "plan ready for review"
    // while the reviewer works; no-ops outside herdr.
    reportState("blocked");
    reportLabel(`plan ready for review: ${review.session.artifact.meta.title ?? review.id}`);

    const timeoutMs = Number(process.env.CUELOOP_WAIT_MS ?? 9 * 60 * 1000);
    const verdict = await review.awaitVerdict({ timeoutMs });
    if (verdict === "pending") {
      // still pending: the pane stays blocked - the review is not done.
      return {
        allow: false,
        reason:
          `cueloop review ${review.id} is still pending. The reviewer has not finished. ` +
          `Do not proceed; present the plan again (or wait) to collect the verdict.`,
      };
    }
    // verdict in hand: the agent goes back to work; replace the label so the
    // sidebar reflects the outcome instead of a stale "ready for review".
    reportState("working");
    reportLabel(`review done: ${verdict.session.verdict!.kind}`);
    return { allow: verdict.allow, reason: verdict.feedback };
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
  // PermissionRequest shape
  return {
    decision: decision.allow ? { behavior: "allow", updatedInput: event.tool_input } : { behavior: "deny", message: decision.reason },
  };
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  let event: HookEvent = {};
  try {
    event = JSON.parse(raw) as HookEvent;
  } catch {
    // no payload: allow rather than wedge the agent on adapter failure
    console.log(JSON.stringify(hookOutput({}, { allow: true, reason: "unparseable hook payload" })));
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
