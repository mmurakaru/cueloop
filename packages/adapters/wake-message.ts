/**
 * The one place that phrases a resolved review as the message that wakes a
 * driving agent's turn. Every non-blocking adapter (pi sendUserMessage, the
 * Claude Code inbox socket, the Codex queue) injects this exact text, so the
 * agent reads the same instruction whatever the harness. feedback.md is carried
 * verbatim after the lead line - it already holds the message kind, the summary,
 * and any annotations.
 */

import type { MessageResult } from "@cueloop/daemon/thread-review";

/** The followUp body a resolved review wakes the turn with. */
export function wakeMessage(sessionId: string, result: MessageResult): string {
  const lead = result.allow
    ? `cueloop review ${sessionId} approved - you may proceed.`
    : `cueloop review ${sessionId} returned changes - address this feedback before proceeding.`;

  return `${lead}\n\n${result.message.body}`;
}
