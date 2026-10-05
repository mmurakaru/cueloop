import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import type { AgentHarnessAdapter } from "@cueloop/schema";
import { OwnerAgentRelay } from "./owner-agent-relay";

/** Exercise the same duplex transport using a local child instead of a live gateway. */
function createTestRelayTransport(
  home: string,
  threadId: string,
  thread: ReturnType<DaemonServer["core"]["sessionGet"]>,
) {
  const script = join(home, "relay.ts");
  const receipt = join(home, "receipt.json");
  const frame = {
    type: "requests",
    thread,
    requests: [
      {
        author: "viewer",
        params: {
          id: threadId,
          text: "Shared question",
          inputOnly: true,
          operationId: "shared-request",
        },
      },
    ],
  };

  writeFileSync(
    script,
    `let buffer = ""; for await (const chunk of Bun.stdin.stream()) { buffer += new TextDecoder().decode(chunk); let newline; while ((newline = buffer.indexOf("\\n")) >= 0) { const frame = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); if (frame.type === "hello") process.stdout.write(${JSON.stringify(JSON.stringify(frame) + "\n")}); if (frame.type === "state" && frame.accepted?.length) await Bun.write(${JSON.stringify(receipt)}, JSON.stringify(frame)); } }`,
  );

  return {
    receipt,
    open: () =>
      Bun.spawn([process.execPath, script], {
        stdin: "pipe" as const,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      }),
  };
}

test("owner relay reconnects after a transport startup failure and durably acknowledges once", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-owner-relay-"));
  let calls = 0;
  const errors: Error[] = [];
  const adapter: AgentHarnessAdapter = {
    id: "test-owner",
    label: "Owner",
    connect: ({ onEvent }) => ({
      start: async () => "owner-session",
      prompt: async () => {
        calls++;
        onEvent({ kind: "message", id: "answer", text: "Shared answer" });

        return { outcome: "completed" as const };
      },
      cancel() {},
      permission() {},
      close() {},
    }),
  };
  const server = new DaemonServer({ home, idleExitMs: 0, threadAgent: { enabled: true, adapter } });

  server.start();
  const thread = server.core.sessionCreate({
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Plan", meta: {} },
  });

  server.core.sessionSetShares(thread.id, [
    { id: "p_abcdefgh", requireAuth: false, allowlist: [], agentEnabled: true },
  ]);
  const shared = server.core.sessionGet(thread.id);
  const transport = createTestRelayTransport(home, thread.id, shared);
  let attempts = 0;
  const relay = new OwnerAgentRelay({
    home,
    enabled: () => true,
    transport: {
      open: () => {
        if (++attempts === 1) throw new Error("Handshake transport failed");

        return transport.open();
      },
    },
    onError: (error) => errors.push(error),
  });
  const client = await DaemonClient.connect({ home });

  try {
    relay.update([shared]);
    for (let turn = 0; !existsSync(transport.receipt) && turn < 200; turn++) await Bun.sleep(5);
    expect(existsSync(transport.receipt)).toBe(true);
    const ack = JSON.parse(readFileSync(transport.receipt, "utf8"));

    expect(ack.accepted).toEqual(["shared-request"]);
    const state = await client.agentGet(thread.id);

    expect(state.promptOperations?.[0]?.operationId).toBe("shared-request");
    expect(state.messages.map((message) => message.text)).toEqual([
      "Shared question",
      "Shared answer",
    ]);
    expect(calls).toBe(1);
    expect(attempts).toBe(2);
    expect(errors.map((error) => error.message)).toEqual(["Handshake transport failed"]);
  } finally {
    relay.stop();
    client.close();
    await server.shutdown();
    rmSync(home, { recursive: true, force: true });
  }
});
