import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { createCodexSessionRegistry } from "@cueloop/adapters/codex/session-registry";

let home: string;
let processHandle: ReturnType<typeof Bun.spawn>;
let server: DaemonServer;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-codex-mcp-"));
});
afterEach(async () => {
  processHandle?.kill();
  if (processHandle) await processHandle.exited;
  server?.stop();
  rmSync(home, { recursive: true, force: true });
});

test("Codex MCP lists the shared workflow tool in a real stdio exchange", async () => {
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  const hookToken = createCodexSessionRegistry(home).activate("codex-mcp-session", home);
  const executable = process.env.CUELOOP_TEST_EXECUTABLE;
  const command = executable
    ? [resolve(executable), "mcp"]
    : [process.execPath, "run", resolve("packages/cli/src/main.ts"), "mcp"];

  processHandle = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CUELOOP_HOME: home },
  });
  // SAFETY: Bun.spawn receives pipe for both streams above.
  const input = processHandle.stdin as Bun.FileSink;
  // SAFETY: Bun.spawn receives pipe for both streams above.
  const output = processHandle.stdout as ReadableStream<Uint8Array>;
  const reader = output.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function receive(id: number): Promise<{
    isError?: boolean;
    result?: {
      tools?: { name: string; inputSchema?: { properties?: { workflow?: { enum?: string[] } } } }[];
      content?: { type: string; text: string }[];
    };
  }> {
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      const newline = buffer.indexOf("\n");

      if (newline >= 0) {
        const line = buffer.slice(0, newline);

        buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line);

        if (message.id === id) return message;

        continue;
      }
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("MCP timeout")), 10_000),
        ),
      ]);

      if (chunk.done) throw new Error("MCP process closed stdout");
      buffer += decoder.decode(chunk.value);
    }

    throw new Error("MCP response timeout");
  }

  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cueloop-test", version: "1.0.0" },
      },
    })}\n`,
  );
  await input.flush();
  expect((await receive(1)).result).toBeDefined();
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  await input.flush();

  const tools = (await receive(2)).result?.tools;

  expect(tools?.map((tool) => tool.name)).toEqual(["open_thread", "refine_corpus"]);
  expect(
    tools?.find((tool) => tool.name === "open_thread")?.inputSchema?.properties?.workflow?.enum,
  ).toEqual(["plan", "reply", "prototype", "diff", "review", "refine"]);

  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "open_thread",
        arguments: {
          workflow: "plan",
          content: "# MCP plan\n\nShip it.",
          harnessSessionId: "codex-mcp-session",
          cwd: home,
          hookToken,
        },
      },
    })}\n`,
  );
  await input.flush();
  const opened = (await receive(3)).result?.content?.[0]?.text;

  expect(opened).toContain('"operation":"open"');
  expect(opened).toContain('"threadId":"ses_');

  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "open_thread",
        arguments: {
          workflow: "plan",
          content: "# Forged plan",
          harnessSessionId: "codex-mcp-session",
          cwd: home,
          hookToken: "forged",
        },
      },
    })}\n`,
  );
  await input.flush();
  expect((await receive(4)).result?.content?.[0]?.text).toContain("not authorized");

  input.end();
  expect(await Promise.race([processHandle.exited, Bun.sleep(2000).then(() => -1)])).toBe(0);
});
