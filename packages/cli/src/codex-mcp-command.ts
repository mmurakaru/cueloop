import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { createCodexDeliveryService } from "@cueloop/adapters/codex/delivery-service";
import { createCodexSessionRegistry } from "@cueloop/adapters/codex/session-registry";
import { runHarnessBridge } from "@cueloop/adapters/harness-bridge";
import { cueloopHome } from "@cueloop/daemon/paths";
import { WORKFLOW_KINDS } from "@cueloop/schema";
import { CLI_VERSION } from "./version";
import { startCodexDeliveryWorker } from "./codex-delivery-worker-command";

const OpenThreadInputSchema = v.object({
  workflow: v.picklist(WORKFLOW_KINDS),
  content: v.optional(v.string()),
  proposal: v.optional(v.string()),
  pullRequestReference: v.optional(v.string()),
  title: v.optional(v.string()),
  harnessSessionId: v.pipe(v.string(), v.minLength(1)),
  cwd: v.string(),
  hookToken: v.pipe(v.string(), v.minLength(1)),
});
const RefineCorpusInputSchema = v.object({});

function mcpInputSchema<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
) {
  const convert = () => toJsonSchema(schema);

  return {
    ...schema,
    "~standard": {
      ...schema["~standard"],
      jsonSchema: { input: convert, output: convert },
    },
  };
}

/** Expose the shared Thread workflows to a standard Codex session. */
export function createCodexMcpServer(home = cueloopHome()): McpServer {
  const server = new McpServer({ name: "cueloop", version: CLI_VERSION });
  const sessions = createCodexSessionRegistry(home);

  server.registerTool(
    "open_thread",
    {
      description:
        "Submit or revise a cueloop Thread for plan, reply, prototype, diff, review, or refine.",
      inputSchema: mcpInputSchema(OpenThreadInputSchema),
    },
    async (input) => {
      try {
        if (!sessions.authorized(input.harnessSessionId, input.cwd, input.hookToken)) {
          throw new Error(
            "cueloop Codex session is not authorized; trust the plugin hooks and restart Codex",
          );
        }
        const { hookToken: _hookToken, ...threadInput } = input;
        const result = await runHarnessBridge(
          { operation: "open", harness: "codex", ...threadInput },
          home,
        );

        if (result.operation === "open") startCodexDeliveryWorker(home);

        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error) }] };
      }
    },
  );
  server.registerTool(
    "refine_corpus",
    {
      description: "Analyze past cueloop Threads before proposing a refine writeback.",
      inputSchema: mcpInputSchema(RefineCorpusInputSchema),
    },
    async () => {
      try {
        const result = await runHarnessBridge({ operation: "refine" }, home);

        return {
          content: [{ type: "text", text: result.operation === "refine" ? result.report : "" }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error) }] };
      }
    },
  );

  return server;
}

/** Keep the MCP transport and durable Codex Message poller alive together. */
export async function codexMcpCommand(): Promise<number> {
  const delivery = createCodexDeliveryService();

  delivery.start();
  const server = serveStdio(() => createCodexMcpServer(), {
    onerror: (error) => console.error(`cueloop Codex MCP: ${String(error)}`),
  });
  await new Promise<void>((resolve) => process.stdin.once("end", resolve));
  delivery.stop();
  await server.close();

  return 0;
}
