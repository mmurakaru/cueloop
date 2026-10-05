import * as v from "valibot";
import type { AgentHarnessEvent } from "@cueloop/schema";

const EnvelopeSchema = v.object({ type: v.string() });
const PiFrameSchema = v.looseObject({ type: v.string() });

type PiHarnessFrame = v.InferOutput<typeof PiFrameSchema>;
const PI_UI_ACTIVITY_METHODS = new Set([
  "select",
  "confirm",
  "input",
  "editor",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);
const PI_ASSISTANT_ACTIVITY_TYPES = new Set([
  "start",
  "done",
  "text_start",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
]);
const PI_ACTIVITY_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "auto_retry_start",
  "auto_retry_end",
  "auto_compaction_start",
  "auto_compaction_end",
  "compaction_start",
  "compaction_end",
  "queue_update",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
]);
const DeltaSchema = v.object({ type: v.string(), delta: v.string() });
const MessageUpdateSchema = v.object({
  assistantMessageEvent: v.unknown(),
  message: v.optional(v.object({ role: v.string() })),
});
const ErrorSchema = v.object({
  reason: v.picklist(["error", "aborted"]),
  error: v.object({ errorMessage: v.optional(v.string()) }),
});
const NotificationSchema = v.object({
  method: v.string(),
  message: v.optional(v.string()),
  notifyType: v.optional(v.string()),
});
const ExtensionErrorSchema = v.object({ error: v.string() });
const ResponseSchema = v.object({ success: v.boolean(), error: v.optional(v.string()) });
const ToolSchema = v.object({
  toolCallId: v.string(),
  toolName: v.string(),
  isError: v.optional(v.boolean()),
});

/** Pi RPC acceptance and agent_end are not settlement; callers retain failures until agent_settled. */
export type PiHarnessOutput =
  | { kind: "event"; event: AgentHarnessEvent }
  | { kind: "activity"; type: string }
  | { kind: "failure"; error: string }
  | { kind: "cancelled" }
  | { kind: "settled" };

/** Normalize pi RPC or SDK events without text filters; stderr is a separate transport channel. */
export function normalizePiHarnessOutput(input: PiHarnessFrame): PiHarnessOutput {
  const frame = input;

  if (PI_ACTIVITY_TYPES.has(frame.type)) return { kind: "activity", type: frame.type };

  switch (frame.type) {
    case "message_update":
      return normalizePiMessageUpdate(input);
    case "extension_ui_request": {
      const notice = v.parse(NotificationSchema, input);

      if (notice.method !== "notify") {
        if (PI_UI_ACTIVITY_METHODS.has(notice.method))
          return { kind: "activity", type: notice.method };

        return piDiagnostic("info", "Pi unhandled extension UI request", JSON.stringify(input));
      }

      return piDiagnostic(notice.notifyType ?? "info", "Pi extension notice", notice.message ?? "");
    }
    case "extension_error":
      return piDiagnostic(
        "error",
        "Pi extension error",
        v.parse(ExtensionErrorSchema, input).error,
      );
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end": {
      const tool = v.parse(ToolSchema, input);

      return {
        kind: "event",
        event: {
          kind: "tool",
          id: tool.toolCallId,
          title: tool.toolName,
          status:
            frame.type === "tool_execution_end"
              ? tool.isError
                ? "failed"
                : "completed"
              : "in_progress",
        },
      };
    }
    case "agent_settled":
      return { kind: "settled" };
    case "response": {
      const response = v.parse(ResponseSchema, input);

      return response.success
        ? { kind: "activity", type: "response" }
        : { kind: "failure", error: response.error ?? "Pi RPC request failed" };
    }
    default:
      return piDiagnostic("info", `Pi unhandled event: ${frame.type}`, JSON.stringify(input));
  }
}

function normalizePiMessageUpdate(input: PiHarnessFrame): PiHarnessOutput {
  const update = v.parse(MessageUpdateSchema, input);
  const event = v.parse(EnvelopeSchema, update.assistantMessageEvent);

  if (update.message && update.message.role !== "assistant")
    throw new Error("Pi harness message_update is not an assistant message");
  if (event.type === "text_delta") {
    const delta = v.parse(DeltaSchema, update.assistantMessageEvent);

    return { kind: "event", event: { kind: "message", text: delta.delta } };
  }
  if (event.type === "error") {
    const failure = v.parse(ErrorSchema, update.assistantMessageEvent);

    return failure.reason === "aborted"
      ? { kind: "cancelled" }
      : { kind: "failure", error: failure.error.errorMessage ?? "Pi model request failed" };
  }

  if (PI_ASSISTANT_ACTIVITY_TYPES.has(event.type)) return { kind: "activity", type: event.type };

  return piDiagnostic(
    "info",
    "Pi unhandled assistant event",
    JSON.stringify(update.assistantMessageEvent),
  );
}

function piDiagnostic(severity: string, title: string, text: string): PiHarnessOutput {
  return {
    kind: "event",
    event: { kind: "diagnostic", severity, title, text, source: "protocol" },
  };
}

/** Validate an untrusted pi protocol frame before normalizing its output channel. */
export const parsePiHarnessOutput = v.parser(
  v.pipe(PiFrameSchema, v.transform(normalizePiHarnessOutput)),
);
