type FxToolResult = {
  resultType: "complete";
  supportedVersions?: string[];
  capabilities?: { tools: object };
  _meta?: { "io.modelcontextprotocol/serverInfo": { name: string; version: string } };
  tools?: AgentHarnessTools["definitions"];
  ttlMs?: number;
  content?: { type: string; text: string }[];
  isError?: boolean;
};
import * as v from "valibot";
import type {
  AgentHarnessAdapter,
  AgentHarnessConnection,
  AgentHarnessOptions,
  AgentHarnessTools,
  AgentHarnessResult,
} from "@cueloop/schema";
import { FxAcpConnection, type FxAcpFrame } from "./acp";
import { FxLegacyStartupMessages } from "./startup-messages";

const ConfigOptionSchema = v.object({
  id: v.string(),
  name: v.string(),
  category: v.optional(v.string()),
  currentValue: v.string(),
  options: v.array(v.object({ value: v.string(), name: v.string() })),
});
const ConfigResultSchema = v.object({ configOptions: v.optional(v.array(ConfigOptionSchema), []) });
const SessionResultSchema = v.object({
  sessionId: v.string(),
  configOptions: v.optional(v.array(ConfigOptionSchema), []),
});
const EmptyResponseSchema = v.nullable(v.object({}));
const InitializeSchema = v.object({
  protocolVersion: v.literal(1),
  agentCapabilities: v.object({ loadSession: v.optional(v.boolean()) }),
});
const UpdateSchema = v.object({
  sessionId: v.string(),
  update: v.looseObject({
    sessionUpdate: v.string(),
    messageId: v.optional(v.string()),
    configOptions: v.optional(v.array(ConfigOptionSchema)),
    content: v.optional(v.unknown()),
    toolCallId: v.optional(v.string()),
    title: v.optional(v.string()),
    kind: v.optional(v.string()),
    status: v.optional(v.picklist(["pending", "in_progress", "completed", "failed", "cancelled"])),
    locations: v.optional(v.array(v.object({ path: v.string(), line: v.optional(v.number()) }))),
  }),
});
const NoticeSchema = v.object({
  update: v.object({
    severity: v.string(),
    title: v.string(),
    description: v.optional(v.nullable(v.string())),
  }),
});
const TextContentSchema = v.object({ type: v.literal("text"), text: v.string() });
const ToolContentSchema = v.array(v.object({ type: v.string(), content: v.optional(v.unknown()) }));
const PermissionSchema = v.object({
  sessionId: v.string(),
  toolCall: v.object({ title: v.optional(v.string()) }),
  options: v.pipe(
    v.array(v.object({ optionId: v.string(), name: v.string(), kind: v.string() })),
    v.maxLength(20),
  ),
});

/** Fx executable and environment are chosen locally, never by socket requests. */
export interface FxHarnessOptions {
  command?: string[];
  env?: NodeJS.ProcessEnv;
}

/** Adapt fx ACP to provider-neutral message, tool, and permission events. */
export function createFxHarness(config: FxHarnessOptions = {}): AgentHarnessAdapter {
  return {
    id: "fx",
    label: "fx",
    connect: (options) => new FxHarnessConnection(config, options),
  };
}

class FxHarnessConnection implements AgentHarnessConnection {
  private readonly connection: FxAcpConnection;
  private readonly startupMessages = new FxLegacyStartupMessages((text) =>
    this.options.onEvent({
      kind: "diagnostic",
      severity: "warning",
      title: "Fx startup notice",
      text,
      source: "legacy-text",
    }),
  );
  private structuredNotices = false;
  private sessionId?: string;
  private loading = true;
  private permissionId?: number | string;

  constructor(
    config: FxHarnessOptions,
    private readonly options: AgentHarnessOptions,
  ) {
    this.sessionId = options.sessionId;
    this.connection = new FxAcpConnection({
      ...config,
      cwd: options.cwd,
      onFrame: (frame) => this.receive(frame),
      onExit: options.onExit,
    });
  }

  private get mcpServers() {
    return this.options.tools
      ? [{ type: "acp" as const, name: "cueloop", serverId: "cueloop" }]
      : [];
  }

  async configure(id: string, value: string): Promise<void> {
    if (!this.sessionId) throw new Error("Fx ACP session is not ready");
    const result = await this.connection.request(
      "session/set_config_option",
      { sessionId: this.sessionId, configId: id, value },
      ConfigResultSchema,
    );

    this.options.onEvent({ kind: "config", options: result.configOptions ?? [] });
  }

  async start(): Promise<string> {
    const initialized = await this.connection.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: { session: { notices: {} } },
        clientInfo: { name: "cueloop", version: "prototype" },
      },
      InitializeSchema,
    );

    if (this.sessionId) {
      if (!initialized.agentCapabilities.loadSession)
        throw new Error("Fx ACP cannot restore the recorded session");
      const result = await this.connection.request(
        "session/load",
        { sessionId: this.sessionId, cwd: this.options.cwd, mcpServers: this.mcpServers },
        ConfigResultSchema,
      );

      this.options.onEvent({ kind: "config", options: result.configOptions ?? [] });
    } else {
      const result = await this.connection.request(
        "session/new",
        { cwd: this.options.cwd, mcpServers: this.mcpServers },
        SessionResultSchema,
      );

      this.sessionId = result.sessionId;
      this.options.onEvent({ kind: "config", options: result.configOptions ?? [] });
    }
    await this.connection.request(
      "session/set_mode",
      { sessionId: this.sessionId, modeId: "ask" },
      EmptyResponseSchema,
    );
    this.loading = false;

    return this.sessionId;
  }

  async prompt(text: string): Promise<AgentHarnessResult> {
    if (!this.sessionId || this.loading)
      return Promise.reject(new Error("Fx ACP session is not ready"));

    let result: { stopReason: string };

    try {
      result = await this.connection.request(
        "session/prompt",
        { sessionId: this.sessionId, prompt: [{ type: "text", text }] },
        v.object({ stopReason: v.string() }),
        10 * 60_000,
      );
    } finally {
      for (const message of this.startupMessages.finish())
        this.options.onEvent({ kind: "message", ...message });
    }

    return {
      outcome:
        result.stopReason === "end_turn"
          ? "completed"
          : result.stopReason === "cancelled"
            ? "cancelled"
            : "incomplete",
    };
  }

  cancel(): void {
    if (this.permissionId !== undefined) this.permission(String(this.permissionId));
    if (!this.loading && this.sessionId)
      this.connection.write({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this.sessionId },
      });
  }

  permission(requestId: string, optionId?: string): void {
    if (this.permissionId === undefined || String(this.permissionId) !== requestId)
      throw new Error("Fx ACP permission request is no longer pending");
    this.connection.write({
      jsonrpc: "2.0",
      id: this.permissionId,
      result: {
        outcome:
          optionId === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId },
      },
    });
    this.permissionId = undefined;
  }

  close(): void {
    this.connection.close();
  }

  private async serveTool(frame: FxAcpFrame): Promise<void> {
    if (frame.id === undefined) return;
    try {
      const params = v.parse(
        v.object({
          serverId: v.literal("cueloop"),
          method: v.string(),
          params: v.optional(v.unknown()),
        }),
        frame.params,
      );
      const tools = this.options.tools;

      if (!tools) throw new Error("Fx ACP cueloop tools are unavailable");
      let result: FxToolResult;

      if (params.method === "server/discover")
        result = {
          resultType: "complete",
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: {} },
          _meta: {
            "io.modelcontextprotocol/serverInfo": { name: "cueloop", version: "prototype" },
          },
        };
      else if (params.method === "tools/list")
        result = { resultType: "complete", tools: tools.definitions, ttlMs: 60000 };
      else if (params.method === "tools/call") {
        const call = v.parse(
          v.object({ name: v.string(), arguments: v.optional(v.unknown(), {}) }),
          params.params,
        );
        const output = await tools.call(call.name, JSON.stringify(call.arguments));

        result = {
          resultType: "complete",
          content: [{ type: "text", text: output }],
          isError: false,
        };
      } else throw new Error("Fx ACP MCP method is unavailable");
      this.connection.write({ jsonrpc: "2.0", id: frame.id, result: { result } });
    } catch (error) {
      this.connection.write({
        jsonrpc: "2.0",
        id: frame.id,
        result: {
          error: {
            code: -32602,
            message: error instanceof Error ? error.message : "Cueloop tool failed",
          },
        },
      });
    }
  }

  private emitAnswer(id: string | undefined, chunk: string): void {
    const text = this.structuredNotices ? chunk : this.startupMessages.push(id, chunk);

    if (text !== undefined) this.options.onEvent({ kind: "message", id, text });
  }

  private receive(frame: FxAcpFrame): void {
    if (frame.method === "mcp/message") {
      void this.serveTool(frame);

      return;
    }
    if (frame.method === "session/request_permission") {
      const params = v.parse(PermissionSchema, frame.params);

      if (params.sessionId !== this.sessionId || frame.id === undefined)
        throw new Error("Fx ACP permission has the wrong session");
      this.permissionId = frame.id;
      this.options.onEvent({
        kind: "permission",
        permission: {
          id: String(frame.id),
          title: params.toolCall.title ?? "Agent action",
          options: params.options,
        },
      });

      return;
    }
    if (frame.method !== "session/update" || this.loading) {
      if (frame.method && frame.id !== undefined)
        this.connection.write({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32601, message: "Cueloop prototype does not support this client method" },
        });

      return;
    }
    const params = v.parse(UpdateSchema, frame.params);

    if (params.sessionId !== this.sessionId) throw new Error("Fx ACP update has the wrong session");
    const update = params.update;

    if (update.sessionUpdate === "notice") {
      const notice = v.parse(NoticeSchema, frame.params);

      for (const message of this.startupMessages.finish())
        this.options.onEvent({ kind: "message", ...message });
      this.structuredNotices = true;

      this.options.onEvent({
        kind: "diagnostic",
        severity: notice.update.severity,
        title: notice.update.title,
        text: notice.update.description ?? "",
        source: "protocol",
      });

      return;
    }
    this.receiveUpdate(update);
  }

  private receiveUpdate(update: v.InferOutput<typeof UpdateSchema>["update"]): void {
    if (
      update.sessionUpdate === "config_option_update" ||
      update.sessionUpdate === "config_options_update"
    ) {
      if (update.configOptions)
        this.options.onEvent({ kind: "config", options: update.configOptions });
    } else if (update.sessionUpdate === "agent_message_chunk") {
      const content = v.safeParse(TextContentSchema, update.content);

      if (content.success) this.emitAnswer(update.messageId, content.output.text);
    } else if (
      (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") &&
      update.toolCallId
    ) {
      const content = v.safeParse(ToolContentSchema, update.content);
      const output = content.success
        ? content.output
            .map((part) => {
              const text = v.safeParse(TextContentSchema, part.content);

              return text.success ? text.output.text : "";
            })
            .join("\n")
        : undefined;

      this.options.onEvent({
        kind: "tool",
        id: update.toolCallId,
        title: update.title,
        toolKind: update.kind,
        status: update.status,
        locations: update.locations,
        output,
      });
    } else if (
      update.sessionUpdate !== "agent_thought_chunk" &&
      update.sessionUpdate !== "user_message_chunk"
    ) {
      this.options.onEvent({
        kind: "diagnostic",
        severity: "info",
        title: "Fx unhandled session update",
        text: JSON.stringify(update),
        source: "protocol",
      });
    }
  }
}
