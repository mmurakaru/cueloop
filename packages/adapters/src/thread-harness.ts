import { existsSync } from "node:fs";
import { createDurableAcpTask, AcpSessionDoc, validateAcpSession } from "./durable-acp-task";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import * as v from "valibot";
import type { Context } from "@earendil-works/chord";
import { Type, type Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  Harness,
  createRegistry,
  defineExtension,
  defineTool,
  watchEvents,
  type Conversation,
  type AgentEventStream,
  type Storage,
  type EntryId,
  type Cursor,
  type EntryRecord,
} from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { createReadTool } from "@earendil-works/pi-durable/tools";
import type {
  AgentHarnessAdapter,
  AgentHarnessOptions,
  AgentHarnessConnection,
  AgentHarnessResult,
} from "@cueloop/schema";
import { PiAnswerProjection } from "./pi/answer-projection";
import { ownerCredentialStore } from "./pi/owner-credentials";

export interface ThreadHarnessOptions {
  backend?: AgentHarnessAdapter;
  home: string;
  models?: Models;
  registry?: () => ReturnType<typeof createRegistry>;
  credentialsPath?: string;
  sourceCredentialsPath?: string;
  removeStorage?: (sessionId: string) => Promise<void>;
  storage?: (sessionId: string, context: Context) => Promise<Storage>;
  env?: (cwd: string) => ExecutionEnv;
}

const context: Context = {
  abortSignal: undefined,
  value: () => undefined,
  toString: () => "cueloop owner harness",
};

/** Each Thread owns its durable conversation; execution and model capabilities are host supplied. */
export function createThreadHarness(config: ThreadHarnessOptions): AgentHarnessAdapter {
  // OAuth's variable imports cannot resolve modules inside a standalone binary.
  registerBunOAuthFlows();
  const models =
    config.models ??
    builtinModels({
      credentials: ownerCredentialStore(
        config.credentialsPath ?? join(config.home, "model-credentials.json"),
        config.sourceCredentialsPath ?? join(homedir(), ".pi", "agent", "auth.json"),
      ),
    });

  return {
    id: config.backend?.id ?? "pi",
    label: config.backend?.label ?? "pi",
    recovery: "durable",
    connect: (options) => new ThreadHarnessConnection(config, models, options),
    remove: async (sessionId) => {
      if (config.removeStorage) await config.removeStorage(sessionId);
      else if (!config.storage)
        await rm(conversationDirectory(config.home, sessionId), {
          recursive: true,
          force: true,
        });
    },
  };
}

class ThreadHarnessConnection implements AgentHarnessConnection {
  private readonly sessionId: string;
  private harness?: Harness;
  private storage?: Storage;
  private starting?: Promise<string>;
  private closePending?: Promise<void>;
  private conversation?: Conversation;
  private stream?: AgentEventStream;
  private closing = false;
  private backend?: AgentHarnessConnection;
  private readonly backendReady = Promise.withResolvers<AgentHarnessConnection>();
  private readonly acp = createDurableAcpTask(
    () => this.backendReady.promise,
    (event) => this.options.onEvent(event),
  );

  constructor(
    private readonly config: ThreadHarnessOptions,
    private readonly models: Models,
    private readonly options: AgentHarnessOptions,
  ) {
    this.sessionId = options.sessionId ?? randomUUID();
    void this.backendReady.promise.catch(() => {});
  }

  start(): Promise<string> {
    if (this.closing) return Promise.reject(new Error("Pi conversation is closed"));

    this.starting ??= this.initialize().catch((error) => {
      this.backendReady.reject(error);
      throw error;
    });

    return this.starting;
  }

  private async initialize(): Promise<string> {
    const registry = (this.config.registry ?? createRegistry)();
    const tools = (this.options.tools?.definitions ?? []).map((definition) =>
      defineTool({
        name: definition.name,
        description: definition.description,
        parameters: Type.Unsafe<Record<string, string>>(definition.inputSchema),
        replay: "unsafe" as const,
        execute: async (args) => ({
          content: [
            {
              type: "text" as const,
              text: await this.options.tools!.call(definition.name, JSON.stringify(args)),
            },
          ],
        }),
      }),
    );

    registry.install(
      defineExtension({
        name: "cueloop",
        tools: [createReadTool(), ...tools],
        tasks: [this.acp.task],
      }),
    );
    const existed = existsSync(conversationDirectory(this.config.home, this.sessionId));

    this.storage = await (this.config.storage
      ? this.config.storage(this.sessionId, context)
      : openNodeJsonlStorage(conversationDirectory(this.config.home, this.sessionId), context));

    if (this.closing) {
      await this.storage.close(context);
      throw new Error("Pi conversation is closed");
    }

    this.harness = await Harness.open(
      this.storage,
      {
        models: this.models,
        registry,
        env: ({ cwd }) =>
          (this.config.env ?? ((directory) => new NodeExecutionEnv({ cwd: directory })))(
            cwd ?? this.options.cwd,
          ),
        settings: { retry: { maxRetries: 2 }, toolExecution: "sequential" },
        onReport: (error) =>
          this.options.onEvent({
            kind: "diagnostic",
            severity: "warning",
            title: "Pi runtime notice",
            text: String(error),
            source: "protocol",
          }),
      },
      context,
    );

    if (this.closing) throw new Error("Pi conversation is closed");

    this.conversation = await this.harness.root(context, { agent: { cwd: this.options.cwd } });

    if (this.config.backend) {
      const saved = await this.harness.snapshot(AcpSessionDoc, this.conversation.id, context);

      if (saved) validateAcpSession(saved);

      this.backend = this.config.backend.connect({
        ...this.options,
        sessionId: saved?.sessionId ?? (!existed ? this.options.sessionId : undefined),
        onEvent: (event) => this.acp.onEvent(event),
      });
      const sessionId = await this.backend.start();

      this.backendReady.resolve(this.backend);

      await this.conversation.commit(async (tx) => {
        (await tx.doc(AcpSessionDoc, this.conversation!.id)).sessionId = sessionId;
      }, context);

      return this.sessionId;
    }

    const available = await this.models.getAvailable();
    const current = (await this.conversation.agent(context)).model;
    const selected =
      current ??
      (available[0] ? { provider: available[0].provider, modelId: available[0].id } : undefined);

    if (selected && !current) await this.conversation.configure({ model: selected }, context);

    if (this.closing) throw new Error("Pi conversation is closed");

    this.options.onEvent({
      kind: "config",
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          currentValue: selected ? `${selected.provider}/${selected.modelId}` : "",
          options: available.map((model) => ({
            value: `${model.provider}/${model.id}`,
            name: model.name,
          })),
        },
      ],
    });

    return this.sessionId;
  }

  async configure(id: string, value: string): Promise<void> {
    if (this.backend?.configure) return this.backend.configure(id, value);

    if (!this.conversation || id !== "model")
      throw new Error("Pi configuration option is unavailable");

    const available = await this.models.getAvailable();
    const model = available.find((model) => `${model.provider}/${model.id}` === value);

    if (!model) throw new Error("Pi model is not available to the owner account");

    await this.conversation.configure(
      { model: { provider: model.provider, modelId: model.id } },
      context,
    );
    this.options.onEvent({
      kind: "config",
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          currentValue: value,
          options: available.map((model) => ({
            value: `${model.provider}/${model.id}`,
            name: model.name,
          })),
        },
      ],
    });
  }

  async prompt(text: string, requestId = randomUUID()): Promise<AgentHarnessResult> {
    const conversation = this.conversation;
    const harness = this.harness;

    if (!conversation || !harness || this.closing) throw new Error("Pi conversation is not ready");

    if (this.backend) return this.acp.prompt(harness, conversation, text, requestId, context);

    const input = await conversation.submit(
      { type: "input", content: text, requestId, whenBusy: "followUp" },
      context,
    );
    const record = await input.status(context);
    const projection = new PiAnswerProjection(record.entry);
    const publish = () => {
      this.options.onEvent({
        kind: "message",
        id: `pi-answer-${requestId}`,
        text: projection.text(),
        replace: true,
      });
    };
    const stream = await watchEvents(harness, conversation.id, context);

    this.stream = stream;
    projection.restore(
      record.entry
        ? await this.answerEntries(record.entry, record.answer)
        : stream.snapshot.entries,
      stream.snapshot,
      record.entry,
    );

    if (projection.text()) publish();

    stream.start(async (events) => {
      for (const event of events) {
        if (event.type === "snapshot") {
          const current = await input.status(context);

          projection.restore(
            current.entry
              ? await this.answerEntries(current.entry, event.entries.at(-1)?.id)
              : event.entries,
            event,
            current.entry,
          );
        } else projection.apply(event);

        if (
          event.type === "message_update" ||
          event.type === "message_end" ||
          event.type === "snapshot"
        )
          publish();

        if (event.type === "tool_execution_start")
          this.options.onEvent({
            kind: "tool",
            id: event.toolCallId,
            title: event.toolName,
            status: "in_progress",
          });

        if (event.type === "tool_execution_end")
          this.options.onEvent({
            kind: "tool",
            id: event.toolCallId,
            title: event.toolName,
            status: event.entry ? "completed" : "failed",
          });
      }
    });
    try {
      const result = await input.wait(context);

      await stream.stop();

      if (result.entry)
        projection.restore(
          await this.answerEntries(result.entry, result.answer),
          undefined,
          result.entry,
        );

      if (projection.text()) publish();

      if (result.status === "unanswered") {
        if (result.reason === "aborted") return { outcome: "cancelled" };

        const parsed = v.safeParse(v.string(), result.detail);
        const detail = parsed.success ? parsed.output : JSON.stringify(result.detail);

        throw new Error(detail ?? `Pi input was not answered: ${result.reason}`);
      }

      return { outcome: result.status === "done" ? "completed" : "incomplete" };
    } finally {
      await stream.stop();
      this.stream = undefined;
    }
  }

  cancel(): void {
    this.acp.cancel();
    this.backend?.cancel();
    void this.conversation?.abort(context).catch(this.options.onExit);
  }
  permission(requestId: string, optionId?: string): void {
    if (this.backend) return this.backend.permission(requestId, optionId);

    throw new Error("Pi conversation has no pending permission");
  }
  close(): Promise<void> {
    this.closing = true;
    this.backendReady.reject(new Error("Thread harness is closed"));
    this.closePending ??= this.finishClose();

    return this.closePending;
  }

  private async finishClose(): Promise<void> {
    await this.starting?.catch(() => {});
    try {
      await this.backend?.close();
    } finally {
      try {
        await this.harness?.close(context);
      } finally {
        await this.stream?.stop();
      }
    }
  }

  private async answerEntries(inputId: EntryId, answerId?: EntryId): Promise<EntryRecord[]> {
    const entries: EntryRecord[] = [];
    let cursor: Cursor | undefined;

    do {
      const page = await this.storage!.scanEntries(
        { conversationId: this.conversation!.id, minEntryId: inputId, maxEntryId: answerId },
        128,
        cursor,
        context,
      );

      entries.unshift(...page.items.slice().reverse());
      cursor = page.next;
    } while (cursor);

    return entries;
  }
}

function conversationDirectory(home: string, sessionId: string): string {
  if (!sessionId || sessionId === "." || sessionId === "..")
    throw new Error("Unsafe Pi conversation ID");

  return join(home, "pi-conversations", encodeURIComponent(sessionId));
}
