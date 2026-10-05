import { createHash } from "node:crypto";
import * as v from "valibot";
import type {
  AgentPromptRequest,
  AgentComment,
  SharedAgentFrame,
  SharedAgentRequest,
  Thread,
  ThreadAgentState,
} from "@cueloop/schema";
import { parseBlocks, resolveAnchor, agentCommentRoot } from "@cueloop/schema";
import { AgentCommentSchema } from "@cueloop/daemon/shared-agent-protocol";
import { parseParams } from "@cueloop/daemon/validate";
import { ThreadAgentSchema, SharedAgentRequestSchema } from "@cueloop/daemon/shared-agent-protocol";
import { openBlob, sealBlob } from "./crypto";
import { unpackGatewayShare } from "./gateway-share-blob";
import type { ShareStore, ShareChangeFeed } from "./store";

type RelayRecord = {
  state?: ThreadAgentState;
  requests: SharedAgentRequest[];
  receipts: Array<{ id: string; fingerprint: string }>;
};
const RelayRecordSchema: v.GenericSchema<RelayRecord> = v.object({
  state: v.optional(ThreadAgentSchema),
  requests: v.array(SharedAgentRequestSchema),
  receipts: v.array(v.object({ id: v.string(), fingerprint: v.string() })),
});

type OwnerConnection = { author: string; send: (frame: SharedAgentFrame) => void };

/** The gateway persists acceptance; only the authenticated owner executes requests. */
export class SharedAgentRelay {
  private readonly owners = new Map<string, OwnerConnection>();
  private readonly changes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: ShareStore & ShareChangeFeed,
    private readonly key: Buffer,
  ) {}

  private async thread(id: string): Promise<Thread> {
    const bytes = await this.store.get(id);

    if (!bytes) throw new Error("Shared agent artifact was not found");
    const thread = unpackGatewayShare(openBlob(this.key, id, bytes), id);

    if (!thread.shares?.[0]?.agentEnabled) throw new Error("Shared agent access is disabled");

    return thread;
  }

  private async read(id: string): Promise<RelayRecord> {
    const bytes = await this.store.get(id + ".agent");

    return bytes
      ? v.parse(
          RelayRecordSchema,
          JSON.parse(Buffer.from(openBlob(this.key, id + ".agent", bytes)).toString("utf8")),
        )
      : { requests: [], receipts: [] };
  }

  private async write(id: string, record: RelayRecord): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(record));

    if (bytes.length > 8 * 1024 * 1024) throw new Error("Shared agent record exceeds 8 MiB");
    await this.store.put(id + ".agent", sealBlob(this.key, id + ".agent", bytes));
  }

  private serialize<T>(id: string, change: () => Promise<T>): Promise<T> {
    const result = (this.changes.get(id) ?? Promise.resolve()).catch(() => {}).then(change);

    this.changes.set(id, result);
    void result
      .finally(() => {
        if (this.changes.get(id) === result) this.changes.delete(id);
      })
      .catch(() => {});

    return result;
  }

  async get(id: string): Promise<ThreadAgentState> {
    const thread = await this.thread(id);
    const record = await this.read(id);
    const state: ThreadAgentState = structuredClone(
      record.state ?? {
        threadId: thread.id,
        phase: { kind: "idle" },
        messages: [],
        tools: [],
        comments: [],
      },
    );

    if (!this.owners.has(id)) state.phase = { kind: "offline" };
    for (const request of record.requests) {
      const { params } = request;

      if (state.promptOperations?.some((receipt) => receipt.operationId === params.operationId))
        continue;
      state.submissions ??= [];
      state.submissions.push({
        id: params.operationId,
        commentId: params.commentId ?? params.operationId,
        prompt: params.text,
        quote: params.context,
        status: "queued",
      });
      state.messages.push({
        id: params.operationId,
        submissionId: params.operationId,
        role: "user",
        text: params.text,
        complete: true,
        revision: thread.revisions.at(-1)?.revision ?? 1,
      });
    }

    return state;
  }

  async prompt(
    id: string,
    author: string,
    incoming: AgentPromptRequest,
  ): Promise<ThreadAgentState> {
    await this.serialize(id, async () => {
      const thread = await this.thread(id);
      const params = parseParams("agent.prompt", incoming);

      if (params.id !== thread.id || !params.operationId || params.retry)
        throw new Error("Shared agent input requires this Thread and a new operation ID");
      const receiptId = createHash("sha256")
        .update(JSON.stringify([id, author, params.operationId]))
        .digest("hex");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([params.text, params.context, params.commentId, params.inputOnly]))
        .digest("hex");
      const record = await this.read(id);
      const receipt = record.receipts.find((entry) => entry.id === receiptId);

      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new Error("Shared agent operation payload conflict");

        return;
      }
      if (record.receipts.length >= 128) throw new Error("Shared agent request capacity reached");
      const pending = thread.annotations.filter(
        (annotation) =>
          !params.inputOnly &&
          (!params.commentId || params.commentId === annotation.id) &&
          annotation.kind === "comment" &&
          annotation.author === author &&
          !record.state?.submissions?.some(
            (submission) => submission.commentId === annotation.id,
          ) &&
          !record.requests.some((request) => request.params.commentId === annotation.id),
      );
      const comments = (record.state?.comments ?? []).filter(
        (comment) =>
          !params.inputOnly &&
          (!params.commentId || params.commentId === comment.id) &&
          comment.author === author &&
          !comment.sent &&
          !record.requests.some((request) => request.params.commentId === comment.id),
      );
      const requests: SharedAgentRequest[] = [...pending, ...comments].map((comment) => {
        const request: SharedAgentRequest = {
          author,
          params: {
            id: thread.id,
            text: comment.body,
            context: comment.anchor.quote,
            discussion: sharedCommentDiscussion(thread, record.state, comment.id),
            commentId: comment.id,
            operationId: `shared-${receiptId}-${record.requests.length}`,
          },
        };

        if ("messageId" in comment) request.comment = comment;

        return request;
      });

      if (!params.commentId && params.text.trim())
        requests.push({
          author,
          params: {
            ...params,
            inputOnly: true,
            text: params.text.trim(),
            operationId: `shared-${receiptId}`,
          },
        });
      if (!requests.length) throw new Error("Shared agent input is empty");
      if (record.requests.length + requests.length > 128)
        throw new Error("Shared agent queue capacity reached");
      record.requests.push(
        ...requests.map((request, index) => ({
          ...request,
          params: { ...request.params, operationId: `${request.params.operationId}-${index}` },
        })),
      );
      record.receipts.push({ id: receiptId, fingerprint });
      await this.write(id, record);
    });
    await this.deliver(id);

    return this.get(id);
  }

  async comment(id: string, author: string, comment: AgentComment): Promise<ThreadAgentState> {
    comment = v.parse(AgentCommentSchema, comment);
    await this.serialize(id, async () => {
      await this.thread(id);
      const record = await this.read(id);
      const previous = record.state?.comments.find((entry) => entry.id === comment.id);

      if (
        !record.state ||
        !record.state.messages.some(
          (message) => message.id === comment.messageId && message.complete,
        )
      )
        throw new Error("Shared agent comment requires a completed answer");
      if (
        record.requests.some((request) => request.params.commentId === comment.id) ||
        previous?.sent ||
        (previous && previous.author !== author)
      )
        throw new Error("Shared agent comment is read-only");
      const message = record.state.messages.find((message) => message.id === comment.messageId)!;
      const resolved = resolveAnchor(comment.anchor, parseBlocks(message.text));

      if (!resolved) throw new Error("Shared agent comment quote does not match its answer");
      if (comment.replyTo) {
        const root = agentCommentRoot(record.state, comment.replyTo);

        if (!root || root.messageId !== comment.messageId)
          throw new Error("Shared agent reply requires a comment in this answer");
      }
      if (!previous && record.state.comments.length >= 128)
        throw new Error("Shared agent comment capacity reached");
      record.state.comments = [
        ...record.state.comments.filter((entry) => entry.id !== comment.id),
        { ...comment, author, sent: false },
      ];
      await this.write(id, record);
    });

    return this.get(id);
  }

  async attach(
    id: string,
    author: string,
    send: (frame: SharedAgentFrame) => void,
  ): Promise<() => Promise<void>> {
    const thread = await this.thread(id);

    if (thread.shares?.[0]?.owner !== author)
      throw new Error("Shared agent connection requires the share owner");
    if (this.owners.has(id)) throw new Error("Shared agent owner is already connected");
    const connection = { author, send };

    this.owners.set(id, connection);
    try {
      await this.deliver(id);
    } catch (error) {
      this.owners.delete(id);
      throw error;
    }
    await this.serialize(id, async () => this.write(id, await this.read(id)));

    return async () => {
      if (this.owners.get(id) !== connection) return;
      this.owners.delete(id);
      await this.serialize(id, async () => this.write(id, await this.read(id)));
    };
  }

  async accept(
    id: string,
    author: string,
    state: ThreadAgentState,
    accepted: string[] = [],
    send?: (frame: SharedAgentFrame) => void,
  ): Promise<void> {
    await this.serialize(id, async () => {
      const thread = await this.thread(id);

      if (
        (send && this.owners.get(id)?.send !== send) ||
        thread.shares?.[0]?.owner !== author ||
        this.owners.get(id)?.author !== author ||
        state.threadId !== thread.id
      )
        throw new Error("Shared agent state requires the connected owner of this Thread");
      const record = await this.read(id);
      const comments =
        record.state?.comments.filter(
          (comment) =>
            !comment.sent &&
            !accepted.some((operation) =>
              record.requests.some(
                (request) =>
                  request.params.operationId === operation &&
                  request.params.commentId === comment.id,
              ),
            ),
        ) ?? [];

      record.state = {
        ...state,
        comments: [
          ...state.comments,
          ...comments.filter((comment) => !state.comments.some((entry) => entry.id === comment.id)),
        ],
      };
      record.requests = record.requests.filter(
        (request) => !accepted.includes(request.params.operationId),
      );
      await this.write(id, record);
    });
  }

  private async deliver(id: string): Promise<void> {
    const owner = this.owners.get(id);

    if (!owner) return;
    owner.send({
      type: "requests",
      thread: await this.thread(id),
      requests: (await this.read(id)).requests,
    });
  }

  edit<T>(id: string, commentId: string | undefined, change: () => Promise<T>): Promise<T> {
    return this.serialize(id, async () => {
      if (commentId && (await this.frozen(id, commentId)))
        throw new Error("Sent agent comments are read-only");

      return change();
    });
  }

  async frozen(id: string, commentId: string): Promise<boolean> {
    const record = await this.read(id);

    return Boolean(
      record.requests.some((request) => request.params.commentId === commentId) ||
      record.state?.submissions?.some((submission) => submission.commentId === commentId),
    );
  }

  subscribe(id: string, listener: () => void): () => void {
    return this.store.subscribe(id + ".agent", listener);
  }
}

function sharedCommentDiscussion(
  thread: Thread,
  state: ThreadAgentState | undefined,
  id: string,
): string {
  const annotation = thread.annotations.find((entry) => entry.id === id);

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
  const comment = state && agentCommentRoot(state, id);
  const root =
    state && comment && (agentCommentRoot(state, comment.replyTo ?? comment.id) ?? comment);

  return JSON.stringify({
    discussion: root
      ? [root, ...state!.comments.filter((entry) => entry.replyTo === root.id)].map((entry) => ({
          id: entry.id,
          body: entry.body,
        }))
      : [],
  });
}
