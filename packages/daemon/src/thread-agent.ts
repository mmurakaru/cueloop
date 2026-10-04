import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import {
  parseBlocks,
  resolveAnchor,
  type AgentComment,
  type Thread,
  type ThreadAgentState,
  type AgentHarnessAdapter,
  type AgentHarnessConnection,
  type AgentHarnessEvent,
  type AgentHarnessResult,
} from "@cueloop/schema";
import { stepAgentTurn, agentTurnCancelled, type AgentTurn } from "./agent-turn";
import { ThreadAgentSchema } from "./thread-agent-validation";

/** Prototype configuration is chosen by the daemon, never an incoming socket caller. */
export interface ThreadAgentOptions {
  home: string;
  enabled: boolean;
  adapter?: AgentHarnessAdapter;
  getThread: (id: string) => Thread;
  onChange: (id: string) => void;
}

interface ActiveAgent {
  connection: AgentHarnessConnection;
  turn: AgentTurn;
  turnId: string;
  revision: number;
}

/** Own harness processes and durable agent transcripts without mutating reviewed artifacts. */
export class ThreadAgentManager {
  private states = new Map<string, ThreadAgentState>();
  private active = new Map<string, ActiveAgent>();
  private readonly directory: string;
  private disposed = false;

  constructor(private readonly options: ThreadAgentOptions) {
    this.directory = join(options.home, "thread-agents");
  }

  /** Read a transcript without starting an agent or contacting a model. */
  get(id: string): ThreadAgentState {
    this.options.getThread(id);
    const cached = this.states.get(id);

    if (cached) return structuredClone(cached);
    const path = this.path(id);
    const state = existsSync(path)
      ? v.parse(ThreadAgentSchema, JSON.parse(readFileSync(path, "utf8")))
      : {
          threadId: id,
          harness: this.options.adapter
            ? { id: this.options.adapter.id, label: this.options.adapter.label }
            : undefined,
          phase: { kind: "idle" as const },
          messages: [],
          tools: [],
          comments: [],
        };

    if (state.threadId !== id) throw new Error("Thread agent record has the wrong thread identity");
    if (state.phase.kind === "running" || state.phase.kind === "permission") {
      state.phase = {
        kind: "failed",
        error: "Agent was interrupted by a daemon restart. Send a message to resume.",
      };
      for (const tool of state.tools) {
        if (tool.status === "pending" || tool.status === "in_progress") tool.status = "cancelled";
      }
    }
    this.states.set(id, state);

    return structuredClone(state);
  }

  /** Start one turn and return immediately so the client can render streamed events. */
  prompt(params: { id: string; text: string; context?: string }): ThreadAgentState {
    if (!this.options.enabled)
      throw new Error(
        "Thread agent prototype is disabled; set CUELOOP_AGENT_THREADS=1 on the daemon",
      );
    const state = this.mutable(params.id);

    if (!this.options.adapter) throw new Error("Thread agent harness is not configured");
    if (state.harness && state.harness.id !== this.options.adapter.id)
      throw new Error("Thread agent belongs to a different harness; create a new Thread");
    state.harness ??= { id: this.options.adapter.id, label: this.options.adapter.label };
    if (state.phase.kind === "running" || state.phase.kind === "permission")
      throw new Error("Thread agent is already running");
    const comments = state.comments.filter((comment) => !comment.sent);
    const text = [
      params.text.trim(),
      comments.length
        ? "Feedback on previous answers:\n" +
          comments
            .map(
              (comment) =>
                `Message ${comment.messageId}\nQuote: ${comment.anchor.quote}\nComment: ${comment.body}`,
            )
            .join("\n\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!text) throw new Error("Thread agent needs a message or pending comments");
    if (state.messages.length >= 128)
      throw new Error("Thread agent prototype reached its 128-message limit");
    const thread = this.options.getThread(params.id);
    const turnId = randomUUID();
    const revision = thread.revisions.at(-1)?.revision ?? 1;
    const prompt = params.context
      ? `${text}\n\nSelected artifact passage (revision ${revision}):\n${params.context}`
      : text;
    const recordedBytes = state.messages.reduce(
      (total, message) => total + Buffer.byteLength(message.text),
      0,
    );

    if (recordedBytes + Buffer.byteLength(prompt) > 2 * 1024 * 1024)
      throw new Error("Thread agent reached its 2 MiB message limit");
    const wirePrompt = `You are assisting with cueloop Thread ${thread.id}, artifact revision ${revision}.\nThe artifact below is review context. Answer the user's request and identify relevant files.\n\nReviewed ${thread.artifact.type}:\n${thread.artifact.content.slice(0, 32_768)}\n\nUser request:\n${prompt}`;

    state.messages.push({ id: turnId, role: "user", text: prompt, complete: true, revision });
    state.phase = { kind: "running" };
    this.save(state);
    void this.run(state, thread, turnId, revision, wirePrompt, comments);

    return structuredClone(state);
  }

  /** Attach quote-primary feedback only to a finalized agent message. */
  comment(params: { id: string; comment: AgentComment }): ThreadAgentState {
    const state = this.mutable(params.id);
    const message = state.messages.find((message) => message.id === params.comment.messageId);

    if (!message || message.role !== "agent" || !message.complete)
      throw new Error("Thread agent comment requires a completed answer");
    if (!resolveAnchor(params.comment.anchor, parseBlocks(message.text)))
      throw new Error("Thread agent comment quote does not resolve");
    const index = state.comments.findIndex((comment) => comment.id === params.comment.id);
    const previous = state.comments[index];
    const root = params.comment.replyTo
      ? state.comments.find((comment) => comment.id === params.comment.replyTo)
      : undefined;

    if (
      params.comment.replyTo &&
      (!root || root.messageId !== message.id || root.id === params.comment.id)
    )
      throw new Error("Thread agent reply requires a comment on the same answer");
    if (previous && (previous.sent || previous.messageId !== params.comment.messageId))
      throw new Error("Thread agent delivered comments are immutable");
    if (Buffer.byteLength(JSON.stringify(params.comment)) > 32_768)
      throw new Error("Thread agent comment exceeds 32 KiB");
    if (index >= 0) state.comments[index] = { ...params.comment, sent: false };
    else {
      if (state.comments.length >= 128)
        throw new Error("Thread agent prototype reached its comment limit");
      state.comments.push({ ...params.comment, sent: false });
    }
    this.save(state);

    return structuredClone(state);
  }

  /** Cancel a turn while retaining its output and waiting for the agent's stop response. */
  cancel(id: string): ThreadAgentState {
    const state = this.mutable(id);
    const active = this.active.get(id);

    if (active && (state.phase.kind === "running" || state.phase.kind === "permission")) {
      active.turn = stepAgentTurn(active.turn, "stop");
      for (const tool of state.tools) {
        if (tool.status === "pending" || tool.status === "in_progress") tool.status = "cancelled";
      }
      state.phase = { kind: "running" };
      active.connection.cancel();
      this.save(state);
    }

    return structuredClone(state);
  }

  /** Answer only the currently waiting permission with one advertised option. */
  permission(params: { id: string; requestId: string; optionId: string }): ThreadAgentState {
    const state = this.mutable(params.id);
    const active = this.active.get(params.id);

    if (
      !active ||
      state.phase.kind !== "permission" ||
      state.phase.permission.id !== params.requestId
    ) {
      throw new Error("Thread agent permission request is no longer pending");
    }
    if (!state.phase.permission.options.some((option) => option.optionId === params.optionId))
      throw new Error("Thread agent permission option was not advertised");
    active.connection.permission(params.requestId, params.optionId);
    state.phase = { kind: "running" };
    this.save(state);

    return structuredClone(state);
  }

  /** Daemon shutdown owns process cleanup; closing a client does not stop a turn. */
  dispose(): void {
    this.disposed = true;
    for (const active of this.active.values()) active.connection.close();
    this.active.clear();
  }

  /** Deleting a Thread also stops its process and removes its private transcript. */
  remove(id: string): void {
    const active = this.active.get(id);

    this.active.delete(id);
    this.states.delete(id);
    active?.connection.close();
    rmSync(this.path(id), { force: true });
    rmSync(this.path(id) + ".tmp", { force: true });
  }

  private mutable(id: string): ThreadAgentState {
    this.get(id);

    return this.states.get(id)!;
  }

  private path(id: string): string {
    return join(this.directory, `${encodeURIComponent(id)}.json`);
  }

  private save(state: ThreadAgentState): void {
    if (this.states.get(state.threadId) !== state) return;
    const data = JSON.stringify(state);

    if (Buffer.byteLength(data) > 8 * 1024 * 1024)
      throw new Error("Thread agent transcript exceeds 8 MiB");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(this.path(state.threadId) + ".tmp", data, { mode: 0o600 });
    renameSync(this.path(state.threadId) + ".tmp", this.path(state.threadId));
    this.options.onChange(state.threadId);
  }

  private async run(
    state: ThreadAgentState,
    thread: Thread,
    turnId: string,
    revision: number,
    prompt: string,
    comments: AgentComment[],
  ): Promise<void> {
    let active = this.active.get(state.threadId);
    const messageStart = state.messages.length;

    try {
      if (!active) {
        const connection = this.options.adapter!.connect({
          cwd: thread.artifact.meta.cwd ?? thread.workspace.repoRoot,
          sessionId: state.harness?.sessionId,
          onEvent: (event) => this.receive(state, event),
          onExit: (error) => {
            if (this.active.get(state.threadId)?.connection !== connection) return;
            this.active.delete(state.threadId);
            if (!this.disposed) {
              state.phase = { kind: "failed", error: error.message };
              this.save(state);
            }
          },
        });

        active = { connection, turn: stepAgentTurn({ kind: "idle" }, "start"), turnId, revision };
        this.active.set(state.threadId, active);
        const sessionId = await connection.start();

        state.harness = {
          id: this.options.adapter!.id,
          label: this.options.adapter!.label,
          sessionId,
        };
        active.turn = stepAgentTurn(active.turn, "ready");
        this.save(state);
      } else {
        active.turn = stepAgentTurn(stepAgentTurn(active.turn, "start"), "ready");
      }
      active.turnId = turnId;
      active.revision = revision;
      // Cancellation during initialization must not submit a new model request.
      if (active.turn.kind === "idle") {
        state.phase = { kind: "idle" };
        this.save(state);

        return;
      }
      const result = await active.connection.prompt(prompt);

      finalizeAgentMessages(state, messageStart, result.outcome);
      if (result.outcome === "completed") for (const comment of comments) comment.sent = true;
      for (const tool of state.tools) {
        if (tool.status === "pending" || tool.status === "in_progress") tool.status = "cancelled";
      }
      state.phase = { kind: "idle" };
      active.turn = stepAgentTurn(active.turn, "finished");
      this.save(state);
    } catch (error) {
      state.phase = {
        kind: "failed",
        error: error instanceof Error ? error.message : "Thread agent request failed",
      };
      this.active.delete(state.threadId);
      active?.connection.close();
      if (!this.disposed) this.save(state);
    }
  }

  private receive(state: ThreadAgentState, event: AgentHarnessEvent): void {
    const active = this.active.get(state.threadId);

    if (!active || active.turn.kind === "starting") return;
    if (event.kind === "permission") {
      if (agentTurnCancelled(active.turn)) {
        active.connection.permission(event.permission.id);

        return;
      }
      state.phase = { kind: "permission", permission: event.permission };
      this.save(state);

      return;
    }
    this.applyUpdate(state, active, event);
  }

  private applyUpdate(
    state: ThreadAgentState,
    active: ActiveAgent,
    update: Exclude<AgentHarnessEvent, { kind: "permission" }>,
  ): void {
    if (update.kind === "message") {
      const messageId = update.id ?? `answer-${active.turnId}`;
      let message = state.messages.find((message) => message.id === messageId);

      if (!message) {
        message = {
          id: messageId,
          role: "agent",
          text: "",
          complete: false,
          revision: active.revision,
        };
        state.messages.push(message);
      }
      if (message.complete) return;
      const used = state.messages.reduce(
        (total, entry) => total + Buffer.byteLength(entry.text),
        0,
      );
      const budget = Math.max(
        0,
        Math.min(320_000 - Buffer.byteLength(message.text), 2 * 1024 * 1024 - used),
      );

      message.text += Buffer.from(update.text).subarray(0, budget).toString("utf8");
    } else {
      let tool = state.tools.find((tool) => tool.id === update.id && tool.turnId === active.turnId);

      if (!tool) {
        if (state.tools.length >= 128)
          throw new Error("Thread agent reached its tool activity limit");
        tool = {
          id: update.id,
          turnId: active.turnId,
          title: (update.title ?? "Agent tool").slice(0, 256),
          kind: update.toolKind ?? "other",
          status: "pending",
          output: "",
          locations: [],
        };
        state.tools.push(tool);
      }
      if (update.title) tool.title = update.title.slice(0, 256);
      if (update.toolKind) tool.kind = update.toolKind;
      if (update.status)
        tool.status = agentTurnCancelled(active.turn) ? "cancelled" : update.status;
      if (update.locations)
        tool.locations = update.locations
          .slice(0, 8)
          .map((location) => ({ ...location, path: location.path.slice(0, 512) }));
      if (update.output !== undefined) tool.output = update.output.slice(0, 8192);
    }
    this.save(state);
  }
}

/** Only this turn can finalize its answers; stopped and historical partials stay incomplete. */
function finalizeAgentMessages(
  state: ThreadAgentState,
  start: number,
  outcome: AgentHarnessResult["outcome"],
): void {
  if (outcome !== "completed") return;
  for (const message of state.messages.slice(start)) message.complete = true;
}
