import * as v from "valibot";
import { MESSAGE_OUTCOMES } from "@cueloop/schema";

/** Tool arguments are validated before entering the owner's daemon API. */
export function parseAgentToolInput(name: string, serialized: string) {
  const input: unknown = JSON.parse(serialized);

  if (name === "reply_to_comment") {
    const args = v.parse(
      v.object({
        id: v.string(),
        commentId: v.string(),
        body: v.pipe(v.string(), v.minLength(1), v.maxLength(32768)),
      }),
      input,
    );

    return { kind: "reply" as const, ...args };
  }
  if (name === "send_message") {
    const args = v.parse(
      v.object({
        id: v.string(),
        outcome: v.picklist(MESSAGE_OUTCOMES),
        summary: v.optional(v.string(), ""),
      }),
      input,
    );

    return { kind: "api" as const, method: "session.sendMessage", params: args };
  }
  if (name !== "cueloop_api") throw new Error("Thread agent tool name is unavailable");
  const args = v.parse(v.object({ method: v.string(), params: v.unknown() }), input);

  return { kind: "api" as const, ...args };
}
