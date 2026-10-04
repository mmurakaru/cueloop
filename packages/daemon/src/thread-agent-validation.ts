import * as v from "valibot";
import type { ThreadAgentState } from "@cueloop/schema";

const AgentAnchorSchema = v.object({
  quote: v.pipe(v.string(), v.minLength(1), v.maxLength(32_768)),
  prefix: v.string(),
  suffix: v.string(),
  blockIndex: v.number(),
  start: v.number(),
  end: v.number(),
  endBlockIndex: v.optional(v.number()),
});

/** Validate agent comments at the socket and persisted transcript boundaries. */
export const AgentCommentSchema = v.object({
  id: v.string(),
  messageId: v.string(),
  anchor: AgentAnchorSchema,
  body: v.pipe(v.string(), v.minLength(1), v.maxLength(32_768)),
  sent: v.boolean(),
  replyTo: v.optional(v.string()),
});

/** Validate persisted agent transcripts independently of submitted artifacts. */
export const ThreadAgentSchema: v.GenericSchema<ThreadAgentState> = v.object({
  threadId: v.string(),
  fxSessionId: v.optional(v.string()),
  phase: v.variant("kind", [
    v.object({ kind: v.literal("idle") }),
    v.object({ kind: v.literal("running") }),
    v.object({ kind: v.literal("failed"), error: v.string() }),
    v.object({
      kind: v.literal("permission"),
      permission: v.object({
        id: v.string(),
        title: v.string(),
        options: v.array(
          v.object({
            optionId: v.string(),
            name: v.string(),
            kind: v.string(),
          }),
        ),
      }),
    }),
  ]),
  messages: v.array(
    v.object({
      id: v.string(),
      role: v.picklist(["user", "agent"]),
      text: v.string(),
      complete: v.boolean(),
      revision: v.number(),
    }),
  ),
  tools: v.array(
    v.object({
      id: v.string(),
      turnId: v.string(),
      title: v.string(),
      kind: v.string(),
      status: v.picklist(["pending", "in_progress", "completed", "failed", "cancelled"]),
      output: v.string(),
      locations: v.array(v.object({ path: v.string(), line: v.optional(v.number()) })),
    }),
  ),
  comments: v.array(AgentCommentSchema),
});
