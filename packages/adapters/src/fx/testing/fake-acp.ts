import { createInterface } from "node:readline";
import * as v from "valibot";

interface FakeAcpResult {
  protocolVersion?: number;
  agentCapabilities?: { loadSession: boolean };
  sessionId?: string;
  stopReason?: string;
}
interface FakeAcpUpdate {
  sessionUpdate: string;
  messageId?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  severity?: string;
  description?: string;
  status?: string;
  content?:
    | { type: string; text: string }
    | { type: string; content: { type: string; text: string } }[];
}
const InputSchema = v.object({
  id: v.optional(v.number()),
  method: v.optional(v.string()),
  params: v.optional(
    v.object({
      sessionId: v.optional(v.string()),
      clientCapabilities: v.optional(
        v.object({ session: v.optional(v.object({ notices: v.optional(v.object({})) })) }),
      ),
      prompt: v.optional(v.array(v.object({ text: v.string() }))),
    }),
  ),
});

const input = createInterface({ input: process.stdin });
let loaded = false;
let noticesSupported = false;
let turn = 0;
let pendingPrompt: number | undefined;
const reply = (id: number, result: FakeAcpResult) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const update = (value: FakeAcpUpdate) =>
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "fx-test-session", update: value },
    }) + "\n",
  );

input.on("line", (line) => {
  const frame = v.parse(InputSchema, JSON.parse(line));

  if (!frame.method && frame.id === 900) {
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: `reply-${turn}`,
      content: { type: "text", text: "Permission rejected." },
    });
    reply(pendingPrompt!, { stopReason: "end_turn" });

    return;
  }
  switch (frame.method) {
    case "initialize":
      noticesSupported = frame.params?.clientCapabilities?.session?.notices !== undefined;
      reply(frame.id!, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
      break;
    case "session/new":
      reply(frame.id!, { sessionId: "fx-test-session" });
      break;
    case "session/set_mode":
      reply(frame.id!, {});
      break;
    case "session/load":
      loaded = frame.params?.sessionId === "fx-test-session";
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "reply-1",
        content: { type: "text", text: "REPLAY SHOULD NOT DUPLICATE" },
      });
      reply(frame.id!, {});
      break;
    case "session/prompt":
      serveTestPrompt(frame);
      break;
    case "session/cancel":
      reply(pendingPrompt!, { stopReason: "cancelled" });
      break;
  }
});

function serveTestPrompt(frame: v.InferOutput<typeof InputSchema>): void {
  turn++;
  const request = frame.params?.prompt?.[0]?.text ?? "";
  const text = request.split("Input: ").at(-1)!;

  if (text.startsWith("structured ")) {
    if (!noticesSupported) throw new Error("Test ACP notice capability was not advertised");
    if (text === "structured transition")
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: `reply-${turn}`,
        content: { type: "text", text: "[context] skill cat" },
      });
    update({
      sessionUpdate: "notice",
      severity: text === "structured notices" ? "future-severity" : "error",
      title: "Optional skill unavailable",
      description: "Continuing without it.",
    });
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: `reply-${turn}`,
      content: {
        type: "text",
        text:
          text === "structured transition"
            ? "alog shortened this is an answer"
            : "[context] skill catalog shortened 112 descriptions: effective=20480 bytes source=compiled default\n",
      },
    });
    reply(frame.id!, { stopReason: "end_turn" });

    return;
  }
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: `startup-${turn}`,
    content: {
      type: "text",
      text: "[context] skill catalog shortened 112 descriptions: effective=20480 bytes source=compiled default\n",
    },
  });
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: `startup-${turn}`,
    content: {
      type: "text",
      text: 'skill discovery warning: candidate "/workspace/.claude/skills/test" was skipped because its linked skill directory could not be resolved to an authorized readable directory; repair or remove the link, or authorize its external location, then reload skills; relaunch with FX_TRACE=1 to write a trace log\n',
    },
  });

  if (text === "startup failure")
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: `startup-${turn}`,
      content: { type: "text", text: "HTTP 401: authentication failed\n" },
    });
  update({
    sessionUpdate: "tool_call",
    toolCallId: `tool-${turn}`,
    title: "Read retry.ts",
    kind: "read",
    status: "in_progress",
  });
  if (text === "hold" || text === "permission") {
    pendingPrompt = frame.id;
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 900,
        method: "session/request_permission",
        params: {
          sessionId: "fx-test-session",
          toolCall: { title: "Run command" },
          options: [{ optionId: "reject", name: "Reject", kind: "reject_once" }],
        },
      }) + "\n",
    );

    return;
  }
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: `tool-${turn}`,
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "retry source" } }],
  });
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: `reply-${turn}-${loaded}`,
    content: {
      type: "text",
      text: loaded
        ? "Loaded fx-test-session."
        : text.includes("Prove this")
          ? text
          : "The timer survives ",
    },
  });
  if (!loaded && !text.includes("Prove this"))
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: `reply-${turn}-${loaded}`,
      content: { type: "text", text: "cancellation." },
    });
  reply(frame.id!, { stopReason: "end_turn" });

  return;
}
