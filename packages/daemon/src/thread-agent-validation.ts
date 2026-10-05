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
  author: v.optional(v.string()),
});

/** Validate persisted agent transcripts independently of submitted artifacts. */
const StoredAgentSchema = v.object({
  threadId: v.string(),
  fxSessionId: v.optional(v.string()),
  harness: v.optional(
    v.object({ id: v.string(), label: v.string(), sessionId: v.optional(v.string()) }),
  ),
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
      submissionId: v.optional(v.string()),
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
  submissions: v.optional(
    v.array(
      v.object({
        id: v.string(),
        commentId: v.optional(v.string()),
        messageId: v.optional(v.string()),
        prompt: v.string(),
        quote: v.optional(v.string()),
        context: v.optional(v.string()),
        status: v.picklist(["queued", "running", "completed", "failed"]),
      }),
    ),
  ),
  configOptions: v.optional(
    v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        category: v.optional(v.string()),
        currentValue: v.string(),
        options: v.array(v.object({ value: v.string(), name: v.string() })),
      }),
    ),
  ),
});

/** Read the first fx prototype's records without discarding their session identity. */
export const ThreadAgentSchema: v.GenericSchema<ThreadAgentState> = v.pipe(
  StoredAgentSchema,
  v.transform(({ fxSessionId, ...state }) => ({
    ...state,
    harness:
      state.harness ??
      (fxSessionId ? { id: "fx", label: "fx", sessionId: fxSessionId } : undefined),
  })),
);
