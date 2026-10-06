import { createLatestStatePublisher } from "./latest-state-publisher";
import * as v from "valibot";
import { DaemonClient, type EventFrame } from "@cueloop/daemon/client";
import { SharedAgentFrameSchema } from "@cueloop/daemon/shared-agent-protocol";
import {
  DEFAULT_SHARE_HOST,
  DEFAULT_SHARE_PORT,
  SHARE_UPLOAD_USER,
} from "@cueloop/daemon/share-blob";
import type { SharedAgentFrame, Thread } from "@cueloop/schema";

export interface OwnerRelayTransport {
  open(): Bun.Subprocess<"pipe", "pipe", "pipe">;
}

export interface OwnerAgentRelayOptions {
  home: string;
  enabled: (thread: Thread) => boolean;
  host?: string;
  port?: number;
  onError: (error: Error) => void;
  transport?: OwnerRelayTransport;
}

type RelayConnection = { stop: () => void; publish: () => Promise<void>; threadId: string };

/** Share requests are acknowledged only after the local daemon persists their operation receipt. */
export class OwnerAgentRelay {
  private readonly connections = new Map<string, RelayConnection>();
  private client?: DaemonClient;
  private reconcilePending = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: OwnerAgentRelayOptions) {}

  update(threads: Thread[]): void {
    this.reconcilePending = this.reconcilePending
      .then(() => this.reconcile(threads))
      .catch(this.options.onError);
  }

  notify(event: EventFrame): void {
    if (event.event !== "agent.updated") return;
    for (const connection of this.connections.values())
      if (connection.threadId === event.sessionId)
        void connection.publish().catch(this.options.onError);
  }

  stop(): void {
    this.stopped = true;
    for (const connection of this.connections.values()) connection.stop();
    this.connections.clear();
    this.client?.close();
    this.client = undefined;
  }

  private async reconcile(threads: Thread[]): Promise<void> {
    if (this.stopped) return;
    const shares = threads
      .filter(this.options.enabled)
      .flatMap((thread) =>
        (thread.shares ?? [])
          .filter((share) => share.agentEnabled)
          .map((share) => ({ thread, share })),
      );
    const wanted = new Set(shares.map(({ share }) => share.id));

    for (const [id, connection] of this.connections)
      if (!wanted.has(id)) {
        connection.stop();
        this.connections.delete(id);
      }
    if (!shares.length) {
      this.client?.close();
      this.client = undefined;

      return;
    }
    this.client ??= await DaemonClient.connect({ home: this.options.home });
    for (const { thread, share } of shares)
      if (!this.connections.has(share.id))
        this.connections.set(share.id, this.open(thread.id, share.id));
  }

  private open(threadId: string, shareId: string): RelayConnection {
    let stopped = false;
    let process: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let writes = Promise.resolve();
    let delay = 250;
    const send = (frame: SharedAgentFrame, child = process): Promise<void> => {
      const write = writes
        .catch(() => {})
        .then(async () => {
          if (stopped || !child || child !== process) return;
          await child.stdin.write(`${JSON.stringify(frame)}\n`);
          await child.stdin.flush();
        });

      writes = write;

      return write;
    };
    const publish = createLatestStatePublisher(async () => {
      if (!stopped) await send({ type: "state", state: await this.client!.agentGet(threadId) });
    });
    const connect = async (): Promise<void> => {
      let child: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
      let stderr = Promise.resolve("");

      try {
        child = openRelayTransport(this.options);
        process = child;
        stderr = new Response(child.stderr).text();
        await send({ type: "hello", shareId }, child);
        let buffer = "";
        const decoder = new TextDecoder();

        for await (const chunk of child.stdout) {
          buffer += decoder.decode(chunk, { stream: true });
          if (Buffer.byteLength(buffer) > 8 * 1024 * 1024)
            throw new Error("Shared agent frame exceeds 8 MiB");
          let newline: number;

          while ((newline = buffer.indexOf("\n")) >= 0) {
            const frame = v.parse(SharedAgentFrameSchema, JSON.parse(buffer.slice(0, newline)));

            buffer = buffer.slice(newline + 1);
            if (
              frame.type !== "requests" ||
              frame.thread.id !== threadId ||
              frame.thread.shares?.[0]?.id !== shareId
            )
              throw new Error("Shared agent relay changed its Thread identity");
            delay = 250;
            const client = this.client!;

            await client.sessionMergeShared(threadId, {
              shareId,
              annotations: frame.thread.annotations,
              participants: frame.thread.participants,
            });
            const accepted: string[] = [];

            for (const request of frame.requests) {
              if (request.params.id !== threadId)
                throw new Error("Shared agent request targets another Thread");
              if (request.comment) {
                const state = await client.agentGet(threadId);

                if (
                  !state.comments.some(
                    (comment) => comment.id === request.comment!.id && comment.sent,
                  )
                )
                  await client.agentComment({
                    id: threadId,
                    comment: { ...request.comment, author: request.author },
                  });
              }
              await client.agentPrompt(request.params);
              accepted.push(request.params.operationId);
            }
            await send({ type: "state", state: await client.agentGet(threadId), accepted }, child);
          }
        }
      } catch (error) {
        if (!stopped) this.options.onError(relayError(error));
        child?.kill();
      } finally {
        await child?.exited;
        if (process === child) process = undefined;
        if (!stopped) {
          const diagnostic = (await stderr).trim();

          if (diagnostic) this.options.onError(new Error(diagnostic));
          retry = setTimeout(() => {
            void connect().catch(this.options.onError);
          }, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      }
    };

    void connect().catch(this.options.onError);

    return {
      threadId,
      publish,
      stop: () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        process?.kill();
      },
    };
  }
}

function openRelayTransport(options: OwnerAgentRelayOptions) {
  if (options.transport) return options.transport.open();
  const command = [
    "ssh",
    "-p",
    String(options.port ?? DEFAULT_SHARE_PORT),
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    `${SHARE_UPLOAD_USER}@${options.host ?? DEFAULT_SHARE_HOST}`,
    "cueloop-agent",
  ];

  return Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
}

function relayError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
