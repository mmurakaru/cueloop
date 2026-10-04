import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";

const ModelRequestSchema = v.object({
  messages: v.array(v.object({ role: v.string() })),
  tools: v.optional(v.array(v.object({ function: v.object({ name: v.string() }) })), []),
});

interface TestFileArguments {
  path: string;
  content?: string;
}

/** Run the real fx binary against a localhost model with an isolated credential-free profile. */
export function createTestFxProvider(
  options: {
    readFile?: boolean;
    writeFile?: boolean;
    hold?: boolean;
    toolCalls?: { name: string; args: Record<string, string> }[];
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "fx-provider-"));
  const workspace = join(home, "workspace");
  const requests: unknown[] = [];
  let toolIndex = 0;
  mkdirSync(workspace);
  writeFileSync(join(workspace, "retry.ts"), "export const retryDelay = 1000;\n");
  mkdirSync(join(home, ".fx"), { mode: 0o700 });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions")
        return new Response("Unexpected endpoint", { status: 500 });
      const body: unknown = await request.json();
      const modelRequest = v.parse(ModelRequestSchema, body);
      requests.push(body);
      const requestedTool = options.toolCalls?.[toolIndex];
      const harnessTool = requestedTool
        ? modelRequest.tools.find((tool) => tool.function.name.endsWith(requestedTool.name))
        : undefined;
      const fileTool =
        harnessTool ??
        modelRequest.tools.find(
          (tool) => tool.function.name === (options.writeFile ? "write_file" : "read_file"),
        );

      if (
        (options.readFile || options.writeFile || requestedTool) &&
        fileTool &&
        (Boolean(harnessTool) || !modelRequest.messages.some((message) => message.role === "tool"))
      ) {
        const toolArguments: TestFileArguments | Record<string, string> =
          harnessTool && requestedTool ? requestedTool.args : { path: join(workspace, "retry.ts") };

        if (harnessTool) toolIndex++;

        if (options.writeFile) toolArguments.content = "export const retryDelay = 2000;\n";
        const chunks = [
          {
            id: "test-tool",
            model: "local-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "read-retry",
                      type: "function",
                      function: {
                        name: fileTool.function.name,
                        arguments: JSON.stringify(toolArguments),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: "test-tool",
            model: "local-model",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          },
        ];

        return new Response(
          chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      const chunks = [
        {
          id: "test-chat",
          model: "local-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content:
                  "## Retry explanation\n\nThe timer survives cancellation.\n\nInspect `retry.ts` before changing it.",
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "test-chat",
          model: "local-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
        {
          id: "test-chat",
          model: "local-model",
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 15, total_tokens: 27 },
        },
      ];

      if (options.hold) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunks[0])}\n\n`));
            request.signal.addEventListener(
              "abort",
              () => {
                try {
                  controller.close();
                } catch {}
              },
              { once: true },
            );
          },
        });

        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }

      return new Response(
        chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  writeFileSync(
    join(home, ".fx/settings.json"),
    JSON.stringify({
      provider: "local",
      auto_upgrade: false,
      permission_mode: "ask",
      providers: {
        local: {
          protocol: "openai-chat-completions",
          base_url: `http://127.0.0.1:${server.port}/v1`,
          auth: { type: "none" },
          model_metadata: {
            "local-model": {
              context_window: 262144,
              max_output_tokens: 8192,
              supports_tool_use: true,
            },
          },
        },
      },
      models: { local: "local-model" },
    }),
    { mode: 0o600 },
  );

  return {
    home,
    workspace,
    requests,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      FX_DISABLE_KEYCHAIN: "1",
      FX_PROVIDER: "local",
      FX_MODEL: "local-model",
      FX_AUTO_UPGRADE: "0",
      FX_SOUND: "0",
      NO_COLOR: "1",
    },
    close() {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    },
  };
}
