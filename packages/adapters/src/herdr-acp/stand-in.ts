import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import * as v from "valibot";

const FrameSchema = v.object({
  id: v.optional(v.number()),
  method: v.optional(v.string()),
  params: v.optional(
    v.object({
      sessionId: v.optional(v.string()),
      prompt: v.optional(v.array(v.object({ text: v.string() }))),
    }),
  ),
});

interface StandInResult {
  protocolVersion?: number;
  agentCapabilities?: { loadSession: boolean };
  sessionId?: string;
  configOptions?: [];
  stopReason?: string;
}

/**
 * Minimal ACP child for the herdr backend. A hold file pauses a prompt so a
 * daemon can exit while the process is still running.
 */
const input = createInterface({ input: process.stdin });
let sessionId = "herdr-stand-in";
let prompts = 0;

const reply = (id: number, result: StandInResult) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const update = (text: string, id: string) =>
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: id,
          content: { type: "text", text },
        },
      },
    }) + "\n",
  );

input.on("line", (line) => {
  let value: ReturnType<typeof JSON.parse>;

  try {
    value = JSON.parse(line);
  } catch {
    return;
  }

  const parsed = v.safeParse(FrameSchema, value);

  if (!parsed.success) return;

  const frame = parsed.output;
  const id = frame.id;

  if (id === undefined) return;

  if (frame.method === "initialize") {
    reply(id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });

    return;
  }

  if (frame.method === "session/new") {
    reply(id, { sessionId, configOptions: [] });

    return;
  }

  if (frame.method === "session/load") {
    sessionId = frame.params?.sessionId ?? sessionId;
    reply(id, { configOptions: [] });

    return;
  }

  if (frame.method === "session/set_mode" || frame.method === "session/set_config_option") {
    reply(id, {});

    return;
  }

  if (frame.method === "session/prompt") {
    prompts += 1;

    if (process.env.HERDR_ACP_COUNT_FILE)
      writeFileSync(process.env.HERDR_ACP_COUNT_FILE, String(prompts));

    const text = frame.params?.prompt?.[0]?.text ?? "";
    const hold = process.env.HERDR_ACP_HOLD_FILE;

    if (hold && text.includes("hold")) {
      update("Partial answer. ", "stand-in-answer");
      writeFileSync(hold, "waiting");
      finishWhenReleased(id, hold);

      return;
    }

    update(`Stand-in answer ${prompts}: ${text}`, "stand-in-answer");
    reply(id, { stopReason: "end_turn" });
  }
});

function finishWhenReleased(id: number, hold: string): void {
  const timer = setInterval(() => {
    let contents = "";

    try {
      contents = readFileSync(hold, "utf8");
    } catch {
      contents = "";
    }

    if (!contents.includes("go")) return;

    clearInterval(timer);
    update("finished after restart.", "stand-in-answer");
    reply(id, { stopReason: "end_turn" });
  }, 20);
}
