import { expect, test } from "bun:test";
import { normalizePiHarnessOutput, parsePiHarnessOutput } from "./harness-output";
import { routeHarnessOutput } from "@cueloop/schema";

test("pi RPC text deltas are assistant text even when they quote startup notices", () => {
  const text =
    "[context] skill catalog shortened 112 descriptions: effective=20480 bytes source=compiled default\n";
  const output = normalizePiHarnessOutput({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: text },
  });

  expect(output).toEqual({ kind: "event", event: { kind: "message", text } });
  if (output.kind === "event") expect(routeHarnessOutput(output.event).destination).toBe("thread");
});

test("pi notifications and extension errors route outside conversation", () => {
  for (const frame of [
    {
      type: "extension_ui_request",
      method: "notify",
      message: "Optional skill missing",
      notifyType: "warning",
    },
    {
      type: "extension_error",
      extensionPath: "test.ts",
      event: "turn_start",
      error: "Extension failed",
    },
  ]) {
    const output = normalizePiHarnessOutput(frame);

    expect(output.kind).toBe("event");
    if (output.kind === "event")
      expect(routeHarnessOutput(output.event).destination).toBe("diagnostics");
  }
});

test("pi errors, cancellation, activity and actual settlement remain distinct", () => {
  expect(
    normalizePiHarnessOutput({
      type: "message_update",
      assistantMessageEvent: {
        type: "error",
        reason: "error",
        error: { errorMessage: "HTTP 401" },
      },
    }),
  ).toEqual({ kind: "failure", error: "HTTP 401" });
  expect(
    normalizePiHarnessOutput({
      type: "message_update",
      assistantMessageEvent: { type: "error", reason: "aborted", error: {} },
    }),
  ).toEqual({ kind: "cancelled" });
  expect(normalizePiHarnessOutput({ type: "agent_end" }).kind).toBe("activity");
  expect(normalizePiHarnessOutput({ type: "agent_settled" }).kind).toBe("settled");
  expect(
    normalizePiHarnessOutput({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" },
    }).kind,
  ).toBe("activity");
});

test("malformed known text events fail validation instead of entering history", () => {
  expect(() =>
    normalizePiHarnessOutput({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: 42 },
    }),
  ).toThrow();
  expect(normalizePiHarnessOutput({ type: "future_notice", detail: "preserved" }).kind).toBe(
    "event",
  );
});

test("pi protocol validation rejects malformed envelopes and SDK messages with the wrong role", () => {
  expect(() => parsePiHarnessOutput(null)).toThrow();
  expect(() =>
    parsePiHarnessOutput({
      type: "message_update",
      message: { role: "user" },
      assistantMessageEvent: { type: "text_delta", delta: "Wrong role" },
    }),
  ).toThrow();
  expect(
    parsePiHarnessOutput({ type: "response", success: false, error: "Invalid session" }),
  ).toEqual({ kind: "failure", error: "Invalid session" });
  expect(
    parsePiHarnessOutput({
      type: "tool_execution_end",
      toolCallId: "read",
      toolName: "read",
      isError: true,
    }),
  ).toEqual({
    kind: "event",
    event: { kind: "tool", id: "read", title: "read", status: "failed" },
  });
});

test("unknown nested pi assistant events retain their payload diagnostically", () => {
  const event = { type: "future_notice", detail: "preserve this" };
  const output = parsePiHarnessOutput({ type: "message_update", assistantMessageEvent: event });

  expect(output.kind).toBe("event");
  if (output.kind === "event" && output.event.kind === "diagnostic")
    expect(JSON.parse(output.event.text)).toEqual(event);
  else throw new Error("Expected retained diagnostic");
});

test("unknown nested pi UI methods retain their payload diagnostically", () => {
  const frame = { type: "extension_ui_request", method: "future_method", detail: "preserve this" };
  const output = parsePiHarnessOutput(frame);

  if (output.kind === "event" && output.event.kind === "diagnostic")
    expect(JSON.parse(output.event.text)).toEqual(frame);
  else throw new Error("Expected retained diagnostic");
});
