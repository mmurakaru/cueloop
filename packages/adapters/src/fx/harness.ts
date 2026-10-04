import * as v from "valibot";
import type {
  AgentHarnessAdapter,
  AgentHarnessConnection,
  AgentHarnessOptions,
  AgentHarnessResult,
} from "@cueloop/schema";
import { FxAcpConnection, type FxAcpFrame } from "./acp";

const SessionResultSchema = v.object({ sessionId: v.string() });
const EmptyResponseSchema = v.nullable(v.object({}));
const InitializeSchema = v.object({
  protocolVersion: v.literal(1),
  agentCapabilities: v.object({ loadSession: v.optional(v.boolean()) }),
});
const UpdateSchema = v.object({
  sessionId: v.string(),
  update: v.object({
    sessionUpdate: v.string(),
    messageId: v.optional(v.string()),
    content: v.optional(v.unknown()),
    toolCallId: v.optional(v.string()),
    title: v.optional(v.string()),
    kind: v.optional(v.string()),
    status: v.optional(v.picklist(["pending", "in_progress", "completed", "failed", "cancelled"])),
    locations: v.optional(v.array(v.object({ path: v.string(), line: v.optional(v.number()) }))),
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

  async start(): Promise<string> {
    const initialized = await this.connection.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "cueloop", version: "prototype" },
      },
      InitializeSchema,
    );

    if (this.sessionId) {
      if (!initialized.agentCapabilities.loadSession)
        throw new Error("Fx ACP cannot restore the recorded session");
      await this.connection.request(
        "session/load",
        { sessionId: this.sessionId, cwd: this.options.cwd, mcpServers: [] },
        EmptyResponseSchema,
      );
    } else {
      const result = await this.connection.request(
        "session/new",
        { cwd: this.options.cwd, mcpServers: [] },
        SessionResultSchema,
      );

      this.sessionId = result.sessionId;
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

    const result = await this.connection.request(
      "session/prompt",
      { sessionId: this.sessionId, prompt: [{ type: "text", text }] },
      v.object({ stopReason: v.string() }),
      10 * 60_000,
    );

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

  private receive(frame: FxAcpFrame): void {
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

    if (update.sessionUpdate === "agent_message_chunk") {
      const content = v.safeParse(TextContentSchema, update.content);

      if (content.success)
        this.options.onEvent({ kind: "message", id: update.messageId, text: content.output.text });
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
    }
  }
}
