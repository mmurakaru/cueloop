import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import {
  parseBlocks,
  routeHarnessOutput,
  agentCommentRoot,
  stepAgentSubmission,
  isAgentNote,
  type AgentSubmission,
  type AgentPromptRequest,
  type AgentHarnessTools,
  resolveAnchor,
  type AgentComment,
  type Thread,
  type ThreadAgentState,
  type AgentHarnessAdapter,
  type AgentHarnessConnection,
  type AgentHarnessEvent,
  type AgentHarnessResult,
} from "@cueloop/schema";
import {
  findPromptOperationReceipt,
  recordPromptOperation,
  settlePromptOperations,
} from "./operation-receipts";
import { writeHarnessDiagnostic } from "./harness-diagnostics";
import { stepAgentTurn, agentTurnCancelled, type AgentTurn } from "./agent-turn";
import { ThreadAgentSchema } from "./thread-agent-validation";

/** Prototype configuration is chosen by the daemon, never an incoming socket caller. */
export interface ThreadAgentOptions {
  home: string;
  enabled: boolean;
  enabledForThread?: (thread: Thread) => boolean;
  adapter?: AgentHarnessAdapter;
  adapters?: Record<string, AgentHarnessAdapter>;
  getThread: (id: string) => Thread;
  onChange: (id: string) => void;
  tools?: (thread: Thread) => AgentHarnessTools;
}

interface ActiveAgent {
  connection: AgentHarnessConnection;
  turn: AgentTurn;
  turnId: string;
  revision: number;
}

/** Own harness processes and durable agent transcripts without mutating reviewed artifacts. */
export class ThreadAgentManager {
  private readonly deleting = new Set<string>();
  private readonly retiring = new Map<string, Promise<void>>();
  private states = new Map<string, ThreadAgentState>();
  private active = new Map<string, ActiveAgent>();
  private readonly directory: string;
  private disposed = false;
  private closing?: Promise<void>;
  private initializing = new Map<string, Promise<ActiveAgent>>();

  constructor(private readonly options: ThreadAgentOptions) {
    this.directory = join(options.home, "thread-agents");
  }

  /** Experimental policy is resolved against the Thread workspace by the local CLI. */
  isEnabled(id: string): boolean {
    return (
      this.options.enabled && (this.options.enabledForThread?.(this.options.getThread(id)) ?? true)
    );
  }

  /** Refuse agent API calls while its experimental flag is disabled. */
  assertEnabled(id: string): void {
    if (this.disposed) throw new Error("Thread agent is shutting down");
    if (!this.isEnabled(id))
      throw new Error(
        "Thread agent is disabled; enable [experimental] thread_agent in config.toml",
      );
  }

  /** Read a transcript without starting an agent or contacting a model. */
  get(id: string): ThreadAgentState {
    this.assertReadable(id);
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
    if (
      state.phase.kind === "running" ||
      state.phase.kind === "permission" ||
      state.submissions?.some((entry) => entry.status === "queued" || entry.status === "running")
    ) {
      state.phase =
        state.harness?.id === "pi"
          ? { kind: "idle" }
          : {
              kind: "failed",
              error: "Agent was interrupted by a daemon restart. Send a message to resume.",
            };
      for (const submission of state.submissions ?? []) {
        if (submission.status === "running" || submission.status === "queued")
          submission.status = state.harness?.id === "pi" ? "queued" : "failed";
      }
      for (const tool of state.tools) {
        if (tool.status === "pending" || tool.status === "in_progress") tool.status = "cancelled";
      }
    }
    settlePromptOperations(state);
    this.states.set(id, state);

    return structuredClone(state);
  }

  /** Freeze each pending comment once and queue an individual answer at the Thread tail. */
  prompt(params: AgentPromptRequest): ThreadAgentState {
    this.assertEnabled(params.id);
    const state = this.mutable(params.id);
    const thread = this.options.getThread(params.id);
    const receipt = findPromptOperationReceipt(state, params);

    if (receipt) {
      this.drain(state);

      return structuredClone(state);
    }
    if (!this.options.adapter) throw new Error("Thread agent harness is not configured");
    if (thread.status !== "pending") throw new Error("Thread agent review is already resolved");
    assertHarnessIdentity(state, this.adapter(state));
    const before = structuredClone(state);

    try {
      state.harness ??= { id: this.options.adapter.id, label: this.options.adapter.label };
      state.submissions ??= [];
      const submissions = state.submissions;
      const revision = thread.revisions.at(-1)?.revision ?? 1;
      const enqueue = (input: Omit<AgentSubmission, "id" | "status">): void =>
        this.enqueue(state, revision, input, promptMirrorIdentity(params));

      if (params.commentId) {
        this.enqueueComment(state, thread, params.commentId, enqueue, params);
      } else if (params.retry) {
        const submission = submissions.find((entry) => entry.id === params.retry);

        if (!submission || submission.status !== "failed")
          throw new Error("Thread agent retry requires a failed submission");
        delete submission.cancelled;
        submission.status = stepAgentSubmission(submission.status, "retry", true);
      } else {
        const accepted = new Set(submissions.map((entry) => entry.commentId));

        for (const annotation of pendingAgentAnnotations(thread, accepted, params.inputOnly))
          this.enqueueComment(state, thread, annotation.id, enqueue);
        for (const comment of state.comments.filter((entry) => !params.inputOnly && !entry.sent))
          this.enqueueComment(state, thread, comment.id, enqueue);
        if (params.text.trim()) enqueue({ prompt: params.text.trim(), quote: params.context });
      }
      recordPromptOperation(state, before, params);
      this.save(state);
    } catch (error) {
      restoreAgentState(state, before);
      throw error;
    }
    this.drain(state);

    return structuredClone(state);
  }

  /** The daemon enforces read-only originals even when a socket client tries to edit them. */
  isReadOnly(id: string, annotationId: string): boolean {
    if (!this.isEnabled(id)) return false;

    return Boolean(this.get(id).submissions?.some((entry) => entry.commentId === annotationId));
  }

  /** Apply harness-advertised choices without submitting a model request. */
  async configure(params: {
    id: string;
    configId?: string;
    value?: string;
  }): Promise<ThreadAgentState> {
    this.assertEnabled(params.id);
    if (!this.options.adapter) throw new Error("Thread agent harness is not configured");
    const state = this.mutable(params.id);

    if (state.phase.kind === "running" || state.phase.kind === "permission") {
      // Discovery can read existing choices without reconfiguring an active turn.
      if (params.configId === undefined || params.value === undefined)
        return structuredClone(state);
      throw new Error("Thread agent configuration waits for the current turn");
    }
    const active = await this.connect(state, this.options.getThread(params.id), "", 1);

    if (params.configId === undefined || params.value === undefined) {
      const current = this.get(params.id);

      if (current.phase.kind !== "running" && current.phase.kind !== "permission")
        active.turn = stepAgentTurn(active.turn, "finished");
      this.drain(state);

      return structuredClone(state);
    }
    if (!active.connection.configure)
      throw new Error("Thread agent harness does not advertise configuration");
    await active.connection.configure(params.configId, params.value);
    this.save(state);

    return structuredClone(state);
  }

  private enqueueComment(
    state: ThreadAgentState,
    thread: Thread,
    commentId: string,
    enqueue: (input: Omit<AgentSubmission, "id" | "status">) => void,
    frozen?: AgentPromptRequest,
  ): void {
    const annotation = thread.annotations.find((entry) => entry.id === commentId);
    const comment = state.comments.find((entry) => entry.id === commentId);
    const input = annotation ?? comment;

    if (!input || state.submissions?.some((submission) => submission.commentId === commentId))
      throw new Error("Shared agent comment is unavailable or already sent");
    enqueue({
      commentId,
      prompt: frozen?.text ?? input.body,
      quote: frozen?.context ?? input.anchor.quote,
      messageId: comment?.messageId,
      context: frozen?.discussion ?? commentDiscussion(state, thread, commentId),
    });
    if (comment) comment.sent = true;
  }

  private enqueue(
    state: ThreadAgentState,
    revision: number,
    input: Omit<AgentSubmission, "id" | "status">,
    operationId?: string,
  ): void {
    const submissions = state.submissions!;

    if (
      state.messages.length +
        submissions.filter((entry) => entry.status === "queued" || entry.status === "running")
          .length +
        2 >
      128
    )
      throw new Error("Thread agent prototype reached its 128-message limit");
    if (Buffer.byteLength(input.prompt) > 320_000 || Buffer.byteLength(input.quote ?? "") > 320_000)
      throw new Error("Thread agent input exceeds 320 KiB");
    const used = state.messages.reduce(
      (total, message) => total + Buffer.byteLength(message.text),
      0,
    );

    if (used + Buffer.byteLength(input.prompt) > 2 * 1024 * 1024)
      throw new Error("Thread agent input exceeds transcript limit");
    const submission: AgentSubmission = {
      ...input,
      id: operationId ?? randomUUID(),
      status: stepAgentSubmission("draft", "submit", true),
    };

    submission.commentId ??= submission.id;
    submissions.push(submission);
    state.messages.push({
      id: submission.id,
      submissionId: submission.id,
      role: "user",
      text: submission.prompt,
      complete: true,
      revision,
    });
  }

  private drain(state: ThreadAgentState): void {
    if (
      this.states.get(state.threadId) !== state ||
      state.phase.kind === "running" ||
      state.phase.kind === "permission" ||
      this.disposed ||
      this.retiring.has(state.threadId)
    )
      return;
    const submission = state.submissions?.find((entry) => entry.status === "queued");

    if (!submission) return;
    const before = structuredClone(state);

    submission.status = stepAgentSubmission(submission.status, "start", true);
    state.phase = { kind: "running" };
    const thread = this.options.getThread(state.threadId);
    const revision = thread.revisions.at(-1)?.revision ?? 1;
    const prompt =
      submission.harnessPrompt ??
      `You are assisting cueloop Thread ${thread.id}. Answer this input individually. Use cueloop tools when the user asks to reply to a comment or return feedback to the main session. A reply to a Changes comment must use its original annotation ID.
Reviewed artifact:
${thread.artifact.content.slice(0, 32768)}
Conversation:
${
  this.adapter(state).id === "pi"
    ? "Continued in the durable conversation."
    : state.messages
        .filter((entry) => entry.submissionId !== submission.id)
        .map((entry) => `${entry.role}: ${entry.text}`)
        .join("\n")
        .slice(-65536)
}
Comment ID: ${submission.commentId ?? "none"}
Quote: ${submission.quote ?? ""}
Discussion context: ${submission.context ?? submission.messageId ?? ""}
Input: ${submission.prompt}`;

    try {
      submission.harnessPrompt = prompt;
      this.save(state);
    } catch (error) {
      // Acceptance is already durable; a retry can resume the queue before any harness request.
      restoreAgentState(state, before);
      throw error;
    }
    void this.run(state, thread, submission.id, revision, prompt, [], submission);
  }

  /** Attach quote-primary feedback only to a finalized agent message. */
  comment(params: { id: string; comment: AgentComment }): ThreadAgentState {
    const state = this.mutable(params.id);
    const message = state.messages.find((message) => message.id === params.comment.messageId);

    if (!message || !message.complete)
      throw new Error("Thread agent comment requires a completed answer");
    if (!resolveAnchor(params.comment.anchor, parseBlocks(message.text)))
      throw new Error("Thread agent comment quote does not resolve");
    const index = state.comments.findIndex((comment) => comment.id === params.comment.id);
    const previous = state.comments[index];
    const root = params.comment.replyTo
      ? agentCommentRoot(state, params.comment.replyTo)
      : undefined;

    if (
      params.comment.replyTo &&
      (!root || root.messageId !== message.id || root.id === params.comment.id)
    )
      throw new Error("Thread agent reply requires a comment on the same answer");
    if (
      this.isReadOnly(params.id, params.comment.id) ||
      (previous && (previous.sent || previous.messageId !== params.comment.messageId))
    )
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

  /** Tool replies preserve the answer discussion and are not re-submitted as user input. */
  reply(id: string, commentId: string, body: string): ThreadAgentState {
    const state = this.mutable(id);
    const comment = agentCommentRoot(state, commentId);

    if (!comment) throw new Error("Thread agent reply comment does not exist");
    const root = agentCommentRoot(state, comment.replyTo ?? comment.id) ?? comment;

    if (state.comments.length >= 128)
      throw new Error("Thread agent prototype reached its comment limit");
    state.comments.push({
      ...root,
      id: randomUUID(),
      body,
      sent: true,
      author: "embedded-agent",
      replyTo: root.id,
    });
    this.save(state);

    return structuredClone(state);
  }

  /** Cancel a turn while retaining its output and waiting for the agent's stop response. */
  cancel(id: string): ThreadAgentState {
    const state = this.mutable(id);
    const active = this.active.get(id);

    if (active && (state.phase.kind === "running" || state.phase.kind === "permission")) {
      active.turn = stepAgentTurn(active.turn, "stop");
      const submission = state.submissions?.find((entry) => entry.status === "running");

      if (submission) submission.cancelled = true;
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
  dispose(): Promise<void> {
    this.disposed = true;
    this.closing ??= Promise.all(
      [...this.active.values()]
        .map((active) => active.connection.close())
        .concat([...this.retiring.values()]),
    ).then(() => {
      this.active.clear();
    });

    return this.closing;
  }

  /** Deleting a Thread also stops its process and removes its private transcript. */
  async remove(id: string): Promise<void> {
    const state = this.mutable(id);

    this.deleting.add(id);
    this.states.delete(id);
    try {
      await this.retiring.get(id);
      const active = this.active.get(id);

      this.active.delete(id);
      active?.connection.cancel();
      await active?.connection.close();
      if (state.harness?.sessionId) await this.adapter(state).remove?.(state.harness.sessionId);
      rmSync(this.path(id), { force: true });
      rmSync(this.path(id) + ".tmp", { force: true });
      rmSync(join(this.directory, `${encodeURIComponent(id)}.diagnostics.ndjson`), { force: true });
    } finally {
      this.deleting.delete(id);
    }
  }

  private adapter(state: ThreadAgentState): AgentHarnessAdapter {
    const adapter =
      (state.harness && this.options.adapters?.[state.harness.id]) ?? this.options.adapter;

    if (!adapter) throw new Error("Thread agent harness is not configured");

    return adapter;
  }

  private assertReadable(id: string): void {
    if (this.deleting.has(id)) throw new Error("Thread agent is being deleted");
    this.options.getThread(id);
  }

  private mutable(id: string): ThreadAgentState {
    this.get(id);

    return this.states.get(id)!;
  }

  private path(id: string): string {
    return join(this.directory, `${encodeURIComponent(id)}.json`);
  }

  private save(state: ThreadAgentState): void {
    settlePromptOperations(state);
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
    submission?: AgentSubmission,
  ): Promise<void> {
    let active = this.active.get(state.threadId);
    const messageStart = state.messages.length;

    try {
      active = await this.connect(state, thread, turnId, revision);
      if (this.states.get(state.threadId) !== state) return;
      active.turnId = turnId;
      active.revision = revision;
      // Cancellation during initialization must not submit a new model request.
      if (active.turn.kind === "idle") {
        if (submission) submission.status = "failed";
        state.phase = { kind: "idle" };
        this.save(state);
        this.drain(state);

        return;
      }
      const result = await active.connection.prompt(prompt, turnId);

      if (this.states.get(state.threadId) !== state) return;
      finalizeAgentMessages(state, messageStart, result.outcome);
      if (submission && result.outcome === "cancelled") submission.cancelled = true;
      if (submission)
        submission.status = stepAgentSubmission(
          submission.status,
          result.outcome === "completed" ? "complete" : "fail",
          true,
        );
      if (result.outcome === "completed") for (const comment of comments) comment.sent = true;
      for (const tool of state.tools) {
        if (tool.status === "pending" || tool.status === "in_progress") tool.status = "cancelled";
      }
      state.phase = { kind: "idle" };
      active.turn = stepAgentTurn(active.turn, "finished");
      this.save(state);
      this.drain(state);
    } catch (error) {
      if (submission) submission.status = "failed";
      state.phase = {
        kind: "failed",
        error: error instanceof Error ? error.message : "Thread agent request failed",
      };
      await this.retire(state.threadId, active);
      if (!this.disposed && this.states.get(state.threadId) === state) {
        this.save(state);
        this.drain(state);
      }
    }
  }

  private retire(id: string, active = this.active.get(id)): Promise<void> {
    const existing = this.retiring.get(id);

    if (existing) return existing;
    this.active.delete(id);
    const closing = Promise.resolve()
      .then(() => active?.connection.close())
      .catch((error) => console.error("[agent cleanup]", error))
      .finally(() => {
        this.retiring.delete(id);
      });

    this.retiring.set(id, closing);

    return closing;
  }

  private async connect(
    state: ThreadAgentState,
    thread: Thread,
    turnId: string,
    revision: number,
  ): Promise<ActiveAgent> {
    const retiring = this.retiring.get(state.threadId);

    if (retiring) await retiring;
    if (this.disposed) throw new Error("Thread agent is shutting down");
    const pending = this.initializing.get(state.threadId);

    if (pending) return pending;
    const promise = this.startConnection(state, thread, turnId, revision);

    this.initializing.set(state.threadId, promise);
    try {
      return await promise;
    } finally {
      this.initializing.delete(state.threadId);
    }
  }

  private async startConnection(
    state: ThreadAgentState,
    thread: Thread,
    turnId: string,
    revision: number,
  ): Promise<ActiveAgent> {
    let active = this.active.get(state.threadId);

    if (!active) {
      const adapter = this.adapter(state);
      const connection = adapter.connect({
        cwd: thread.artifact.meta.cwd ?? thread.workspace.repoRoot,
        sessionId: state.harness?.sessionId,
        tools: this.options.tools?.(thread),
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

      if (this.states.get(state.threadId) !== state) throw new Error("Thread agent was removed");
      state.harness = {
        id: adapter.id,
        label: adapter.label,
        sessionId,
      };
      active.turn = stepAgentTurn(active.turn, "ready");
      this.save(state);
    } else {
      active.turn = stepAgentTurn(stepAgentTurn(active.turn, "start"), "ready");
    }

    return active;
  }

  private receive(state: ThreadAgentState, event: AgentHarnessEvent): void {
    if (this.states.get(state.threadId) !== state) return;
    const routed = routeHarnessOutput(event);

    if (routed.destination === "diagnostics") {
      writeHarnessDiagnostic(this.directory, state.threadId, routed.event);

      return;
    }
    event = routed.event;
    if (event.kind === "config") {
      state.configOptions = event.options;
      this.save(state);

      return;
    }
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
    update: Extract<AgentHarnessEvent, { kind: "message" | "tool" }>,
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
          submissionId: active.turnId,
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

      message.text = update.replace
        ? Buffer.from(update.text)
            .subarray(
              0,
              Math.max(
                0,
                Math.min(320_000, 2 * 1024 * 1024 - used + Buffer.byteLength(message.text)),
              ),
            )
            .toString("utf8")
        : message.text + Buffer.from(update.text).subarray(0, budget).toString("utf8");
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

function isPendingAgentInput(
  annotation: Thread["annotations"][number],
  accepted: Set<string | undefined>,
): boolean {
  return (
    annotation.kind === "comment" &&
    !isAgentNote(annotation) &&
    !annotation.author &&
    !accepted.has(annotation.id)
  );
}

function restoreAgentState(state: ThreadAgentState, before: ThreadAgentState): void {
  if (before.submissions === undefined) delete state.submissions;
  if (before.promptOperations === undefined) delete state.promptOperations;
  if (before.harness === undefined) delete state.harness;
  Object.assign(state, before);
}

function assertHarnessIdentity(state: ThreadAgentState, adapter: AgentHarnessAdapter): void {
  if (state.harness && state.harness.id !== adapter.id)
    throw new Error("Thread agent belongs to a different harness; create a new Thread");
}

function promptMirrorIdentity(params: AgentPromptRequest): string | undefined {
  return params.inputOnly ? params.operationId : undefined;
}

function pendingAgentAnnotations(
  thread: Thread,
  accepted: Set<string | undefined>,
  inputOnly?: boolean,
) {
  return inputOnly
    ? []
    : thread.annotations.filter((annotation) => isPendingAgentInput(annotation, accepted));
}

function commentDiscussion(state: ThreadAgentState, thread: Thread, commentId: string): string {
  const annotation = thread.annotations.find((entry) => entry.id === commentId);

  if (annotation) {
    const root =
      thread.annotations.find((entry) => entry.id === (annotation.replyTo ?? annotation.id)) ??
      annotation;

    return JSON.stringify({
      target: root.target,
      discussion: thread.annotations
        .filter((entry) => entry.id === root.id || entry.replyTo === root.id)
        .map((entry) => ({ id: entry.id, body: entry.body })),
    });
  }
  const comment = agentCommentRoot(state, commentId)!;
  const root = agentCommentRoot(state, comment.replyTo ?? comment.id) ?? comment;

  return JSON.stringify({
    discussion: [root, ...state.comments.filter((entry) => entry.replyTo === root.id)].map(
      (entry) => ({ id: entry.id, body: entry.body }),
    ),
  });
}
