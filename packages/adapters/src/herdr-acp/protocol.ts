import * as v from "valibot";

export const RelayPromptSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  stopReason: v.nullable(v.string()),
});

export const RelayStateSchema = v.object({
  epoch: v.pipe(v.string(), v.minLength(1)),
  sessionId: v.nullable(v.string()),
  sequence: v.pipe(v.number(), v.integer(), v.minValue(0)),
  cursor: v.pipe(v.number(), v.integer(), v.minValue(0)),
  prompt: v.nullable(RelayPromptSchema),
  running: v.boolean(),
  pid: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export type RelayState = v.InferOutput<typeof RelayStateSchema>;

export const ClientOpSchema = v.variant("op", [
  v.object({ op: v.literal("attach") }),
  v.object({ op: v.literal("follow") }),
  v.object({ op: v.literal("write"), line: v.string() }),
  v.object({
    op: v.literal("replay"),
    after: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
  v.object({ op: v.literal("shutdown") }),
]);

export type ClientOp = v.InferOutput<typeof ClientOpSchema>;

export const RelayOpSchema = v.variant("op", [
  v.object({ op: v.literal("state"), state: RelayStateSchema }),
  v.object({
    op: v.literal("stdout"),
    cursor: v.pipe(v.number(), v.integer(), v.minValue(1)),
    line: v.string(),
  }),
  v.object({
    op: v.literal("replay-end"),
    cursor: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
  v.object({ op: v.literal("exit"), code: v.nullable(v.number()) }),
  v.object({ op: v.literal("replaced") }),
]);

export type RelayOp = v.InferOutput<typeof RelayOpSchema>;

export interface StdoutLine {
  cursor: number;
  line: string;
}
