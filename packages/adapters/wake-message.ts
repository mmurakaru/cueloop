/**
 * The one place that phrases a resolved review as the message that wakes a
 * driving agent's turn. Every non-blocking adapter (pi sendUserMessage,
 * Claude Mod prompt submission, the Codex queue) injects this exact text, so the
 * agent reads the same instruction whatever the harness. feedback.md is carried
 * verbatim after the lead line - it already holds the message kind, the summary,
 * and any annotations.
 */

import type { MessageResult } from "@cueloop/daemon/thread-review";
import type { Message } from "@cueloop/schema";

/** The followUp body a resolved review wakes the turn with. */
export function wakeMessage(sessionId: string, result: MessageResult | Message): string {
  const message = "message" in result ? result.message : result;
  const allowed = "allow" in result ? result.allow : result.outcome === "approved";
  const lead = allowed
    ? `cueloop review ${sessionId} approved - you may proceed.`
    : `cueloop review ${sessionId} returned changes - address this feedback before proceeding.`;

  return `${lead}\n\n${message.body}`;
}
