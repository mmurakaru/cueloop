import * as v from "valibot";
import {
  newAnnotationId,
  type Annotation,
  type Artifact,
  type Message,
  type MessageOutcome,
  type Thread,
  type ThreadAgentState,
  type WorkspaceKey,
} from "@cueloop/schema";
import { DaemonClient, DaemonClientError, type ConnectOptions } from "./client";
import { DaemonTransportError, type DaemonRequestOptions } from "./client-errors";
import {
  createSdkThreadId,
  createSdkOperationId,
  createSdkSubmissionId,
  type SdkThreadId,
  type SdkOperationId,
  type SdkSubmissionId,
} from "./sdk-identities";
export {
  createSdkThreadId,
  createSdkOperationId,
  createSdkSubmissionId,
  type SdkThreadId,
  type SdkOperationId,
  type SdkSubmissionId,
} from "./sdk-identities";
import { ThreadRecordSchema } from "./validate";
import { ThreadAgentSchema } from "./thread-agent-validation";
import { connectThreadObserver, subscribeThreadState } from "./thread-subscription";

/** Validated SDK Thread reads carry a distinct identity without changing the wire model. */
export type SdkThread = Thread & { id: SdkThreadId };
const SdkThreadRecordSchema = v.pipe(
  ThreadRecordSchema,
  v.transform((thread): SdkThread => ({ ...thread, id: createSdkThreadId(thread.id) })),
);

/** These errors preserve daemon rejection codes and uncertainty after a lost response. */
export type DaemonSdkError = DaemonClientError | DaemonTransportError;

/** Acceptance identifies the exact batch; idle Thread state alone does not prove completion. */
export interface AgentAcceptance {
  threadId: SdkThreadId;
  operationId: SdkOperationId;
  submissionIds: readonly SdkSubmissionId[];
}

/** Explicit cancellation and failed execution remain distinct terminal outcomes. */
export interface AgentCompletion extends AgentAcceptance {
  outcome: "completed" | "failed" | "cancelled";
  state: ThreadAgentState;
}

/** A review capability cannot create Threads, submit agents, or resolve reviews. */
export class ReviewDaemonSdk {
  readonly ids = {
    thread: createSdkThreadId,
    operation: createSdkOperationId,
    submission: createSdkSubmissionId,
  };

  protected closed = false;
  private readonly observers = new Set<() => void>();

  constructor(
    protected readonly client: DaemonClient,
    protected readonly connectionOptions: ConnectOptions = {},
  ) {}

  /** Snapshot observation owns a separate connection and never replays mutations. */
  observeThread(input: {
    threadId: SdkThreadId;
    onValue: (thread: SdkThread) => void;
    onError: (error: DaemonSdkError) => void;
  }): () => void {
    if (this.closed) {
      input.onError(new DaemonTransportError("connection", "SDK connection is closed", "not_sent"));

      return () => {};
    }
    const dispose = subscribeThreadState({
      connect: connectThreadObserver(this.connectionOptions),
      matches: (event) => event.sessionId === input.threadId,
      read: (client, signal) =>
        client.request("session.get", { id: input.threadId }, SdkThreadRecordSchema, { signal }),
      onValue: input.onValue,
      onError: (error) => input.onError(normalizeSdkError(error)),
    });
    const stop = () => {
      dispose();
      this.observers.delete(stop);
    };

    this.observers.add(stop);

    return stop;
  }

  get threads() {
    return {
      get: (threadId: SdkThreadId, options?: DaemonRequestOptions): Promise<SdkThread> =>
        this.client.request("session.get", { id: threadId }, SdkThreadRecordSchema, options),
    };
  }

  readonly comments = {
    add: (
      input: { threadId: SdkThreadId; annotation: Parameters<DaemonClient["sessionComment"]>[1] },
      options?: DaemonRequestOptions,
    ): Promise<SdkThread> =>
      this.client.request(
        "session.comment",
        { id: input.threadId, annotation: input.annotation },
        SdkThreadRecordSchema,
        options,
      ),
    list: async (threadId: SdkThreadId, options?: DaemonRequestOptions): Promise<Annotation[]> =>
      (await this.threads.get(threadId, options)).annotations,
    reply: async (
      input: { threadId: SdkThreadId; commentId: string; body: string; replyId?: string },
      options?: DaemonRequestOptions,
    ): Promise<SdkThread> => {
      const thread = await this.threads.get(input.threadId, options);
      const comment = thread.annotations.find((entry) => entry.id === input.commentId);

      if (!comment)
        throw new DaemonClientError("not_found", "SDK comment reply target does not exist");
      const rootId = comment.replyTo ?? comment.id;
      const root = thread.annotations.find((entry) => entry.id === rootId);

      if (!root) throw new DaemonClientError("not_found", "SDK comment reply root does not exist");

      return this.client.request(
        "session.comment",
        {
          id: input.threadId,
          annotation: {
            id: input.replyId ?? newAnnotationId(),
            kind: "comment",
            anchor: root.anchor,
            target: root.target,
            replyTo: root.id,
            body: input.body,
          },
        },
        SdkThreadRecordSchema,
        options,
      );
    },
  };

  close(): void {
    this.closed = true;
    for (const stop of this.observers) stop();
    this.client.close();
  }
}

/** Owner methods still require daemon token authorization and the experimental agent flag. */
export class OwnerDaemonSdk extends ReviewDaemonSdk {
  get threads() {
    return {
      ...super.threads,
      create: (
        input: { workspace: WorkspaceKey; artifact: Artifact },
        options?: DaemonRequestOptions,
      ): Promise<SdkThread> =>
        this.client.request("session.create", input, SdkThreadRecordSchema, options),
    };
  }

  readonly sessions = {
    sendMessage: async (
      input: {
        threadId: SdkThreadId;
        operationId: SdkOperationId;
        outcome: MessageOutcome;
        summary: string;
        actionBodies?: Record<string, string>;
      },
      options?: DaemonRequestOptions,
    ): Promise<Message> => {
      const thread = await this.client.sessionSendMessage(
        input.threadId,
        input.outcome,
        input.summary,
        input.actionBodies,
        input.operationId,
        options,
      );

      if (!thread.message)
        throw new DaemonTransportError(
          "protocol",
          "SDK accepted review message is missing",
          "unknown",
          "session.sendMessage",
        );

      return thread.message;
    },
  };

  readonly agents = {
    get: (threadId: SdkThreadId, options?: DaemonRequestOptions): Promise<ThreadAgentState> =>
      this.client.request("agent.get", { id: threadId }, ThreadAgentSchema, options),
    prompt: async (
      input: {
        threadId: SdkThreadId;
        operationId: SdkOperationId;
        text: string;
        context?: string;
        retry?: SdkSubmissionId;
      },
      options?: DaemonRequestOptions,
    ): Promise<AgentAcceptance> => {
      const state = await this.client.agentPrompt(
        {
          id: input.threadId,
          operationId: input.operationId,
          text: input.text,
          context: input.context,
          retry: input.retry,
        },
        options,
      );
      const receipt = state.promptOperations?.find(
        (entry) => entry.operationId === input.operationId,
      );

      if (!receipt)
        throw new DaemonTransportError(
          "protocol",
          "SDK accepted agent operation receipt is missing",
          "unknown",
          "agent.prompt",
        );

      return {
        threadId: input.threadId,
        operationId: input.operationId,
        submissionIds: receipt.result.map(createSdkSubmissionId),
      };
    },
    replyToComment: (
      input: { threadId: SdkThreadId; commentId: string; body: string },
      options?: DaemonRequestOptions,
    ): Promise<ThreadAgentState> =>
      this.client.request(
        "agent.reply",
        { id: input.threadId, commentId: input.commentId, body: input.body },
        ThreadAgentSchema,
        options,
      ),
    wait: (accepted: AgentAcceptance, options?: DaemonRequestOptions): Promise<AgentCompletion> =>
      this.waitAgentCompletion(accepted, options),
    cancel: (threadId: SdkThreadId, options?: DaemonRequestOptions): Promise<ThreadAgentState> =>
      this.client.request("agent.cancel", { id: threadId }, ThreadAgentSchema, options),
  };

  private readonly waits = new Set<AbortController>();

  override close(): void {
    this.closed = true;
    for (const wait of this.waits) wait.abort();
    super.close();
  }

  private waitAgentCompletion(
    accepted: AgentAcceptance,
    options: DaemonRequestOptions = {},
  ): Promise<AgentCompletion> {
    if (this.closed)
      return Promise.reject(
        new DaemonTransportError("connection", "SDK connection is closed", "not_sent"),
      );
    if (!accepted.submissionIds.length)
      return Promise.reject(
        new DaemonClientError("invalid_params", "SDK wait requires accepted submissions"),
      );

    const controller = new AbortController();

    this.waits.add(controller);
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;

    return new Promise((resolve, reject) => {
      let done = false;
      let detach: (() => void) | undefined;
      const finish = (result?: AgentCompletion, error?: DaemonSdkError) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.waits.delete(controller);
        detach?.();
        if (result) resolve(result);
        else reject(error);
      };
      const abort = () =>
        finish(
          undefined,
          new DaemonTransportError("cancelled", "SDK agent wait cancelled locally", "not_sent"),
        );
      const timer = setTimeout(
        () =>
          finish(
            undefined,
            new DaemonTransportError(
              "timeout",
              "SDK agent completion deadline elapsed",
              "not_sent",
            ),
          ),
        options.timeoutMs ?? 30_000,
      );

      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();

        return;
      }
      detach = subscribeThreadState({
        connect: connectThreadObserver(this.connectionOptions),
        matches: (event) =>
          event.event === "agent.updated" && event.sessionId === accepted.threadId,
        read: (client, readSignal) =>
          client.request("agent.get", { id: accepted.threadId }, ThreadAgentSchema, {
            signal: readSignal,
          }),
        onValue: (state) => {
          const receipt = state.promptOperations?.find(
            (entry) => entry.operationId === accepted.operationId,
          );

          if (!receipt || receipt.result.join("\n") !== accepted.submissionIds.join("\n")) {
            finish(
              undefined,
              new DaemonClientError("not_found", "SDK accepted agent operation no longer exists"),
            );

            return;
          }
          if (receipt.outcome) finish({ ...accepted, outcome: receipt.outcome, state });
        },
        onError: (error) => {
          if (
            error instanceof DaemonClientError ||
            (error instanceof DaemonTransportError && error.kind === "protocol")
          )
            finish(undefined, normalizeSdkError(error));
        },
      });
    });
  }

  constructor(client: DaemonClient, connectionOptions: ConnectOptions) {
    super(client, connectionOptions);
  }
}

/** Choose capabilities at connection time; the daemon remains the authority. */
export async function connectOwnerSdk(
  options: Omit<ConnectOptions, "role"> = {},
): Promise<OwnerDaemonSdk> {
  return new OwnerDaemonSdk(await DaemonClient.connect({ ...options, role: "owner" }), {
    ...options,
    role: "owner",
  });
}

/** Collaborators and review agents expose only shared review operations. */
export async function connectReviewSdk(
  options: ConnectOptions & { role: "collaborator" | "agent" },
): Promise<ReviewDaemonSdk> {
  return new ReviewDaemonSdk(await DaemonClient.connect(options), options);
}

/** Preserve typed failures; unexpected transport exceptions carry their original cause. */
// eslint-disable-next-line type-evidence/no-unknown-parameters -- Promise rejection is an untyped transport boundary.
export function normalizeSdkError(error: unknown): DaemonSdkError {
  if (error instanceof DaemonClientError || error instanceof DaemonTransportError) return error;

  return new DaemonTransportError(
    "connection",
    "SDK daemon operation failed",
    "unknown",
    undefined,
    { cause: error },
  );
}
