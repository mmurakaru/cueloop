import type { MessageResult } from "@cueloop/daemon/thread-review";
import type { Message } from "@cueloop/schema";

/** The followUp body a resolved review wakes the turn with. */
export function wakeMessage(sessionId: string, result: MessageResult | Message): string {
  const message = "message" in result ? result.message : result;
  const allowed = "allow" in result ? result.allow : result.outcome === "approved";
  const lead =
    message.outcome === "comment"
      ? `cueloop Thread ${sessionId} has new comments - the Thread remains open.`
      : allowed
        ? `cueloop review ${sessionId} approved - you may proceed.`
        : `cueloop review ${sessionId} returned changes - address this feedback before proceeding.`;

  return `${lead}\n\n${message.body}`;
}
