import * as v from "valibot";
import { ThreadRecordSchema, Params } from "./validate";
import { AgentCommentSchema, ThreadAgentSchema } from "./thread-agent-validation";

/** Both SSH endpoints validate relay frames before using owner or collaborator data. */
export const SharedAgentRequestSchema = v.object({
  author: v.string(),
  params: v.object({
    ...Params["agent.prompt"].entries,
    operationId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  }),
  comment: v.optional(AgentCommentSchema),
});

/** A relay cannot carry executable configuration, credentials, or arbitrary daemon methods. */
export const SharedAgentFrameSchema = v.variant("type", [
  v.object({ type: v.literal("hello"), shareId: v.string() }),
  v.object({
    type: v.literal("requests"),
    thread: ThreadRecordSchema,
    requests: v.array(SharedAgentRequestSchema),
  }),
  v.object({
    type: v.literal("state"),
    state: ThreadAgentSchema,
    accepted: v.optional(v.array(v.string())),
  }),
]);

export { ThreadAgentSchema, AgentCommentSchema } from "./thread-agent-validation";
