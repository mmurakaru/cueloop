import * as v from "valibot";
import type { AgentHarnessEvent } from "@cueloop/schema";

const HarnessEventSchema: v.GenericSchema<AgentHarnessEvent> = v.variant("kind", [
  v.object({
    kind: v.literal("message"),
    id: v.optional(v.string()),
    text: v.string(),
    replace: v.optional(v.boolean()),
  }),
  v.object({
    kind: v.literal("diagnostic"),
    severity: v.string(),
    title: v.string(),
    text: v.string(),
    source: v.picklist(["protocol", "legacy-text"]),
  }),
  v.object({
    kind: v.literal("tool"),
    id: v.string(),
    title: v.optional(v.string()),
    toolKind: v.optional(v.string()),
    status: v.optional(v.picklist(["pending", "in_progress", "completed", "failed", "cancelled"])),
    output: v.optional(v.string()),
    locations: v.optional(v.array(v.object({ path: v.string(), line: v.optional(v.number()) }))),
  }),
  v.object({
    kind: v.literal("permission"),
    permission: v.object({
      id: v.string(),
      title: v.string(),
      options: v.array(v.object({ optionId: v.string(), name: v.string(), kind: v.string() })),
    }),
  }),
  v.object({
    kind: v.literal("config"),
    options: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        category: v.optional(v.string()),
        currentValue: v.string(),
        options: v.array(v.object({ value: v.string(), name: v.string() })),
      }),
    ),
  }),
]);

/** Stored progress is validated before it can affect a restored Thread. */
export function parseHarnessEvent(serialized: string): AgentHarnessEvent {
  return v.parse(HarnessEventSchema, JSON.parse(serialized));
}
