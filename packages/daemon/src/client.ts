/**
 * Daemon client: the one library every consumer shares - CLI verbs, the TUI,
 * adapters, and tests. Also owns the lazy-launch story: connect() with
 * autostart spawns a detached daemon when the socket is dead, then attaches.
 */

import { existsSync, rmSync } from "node:fs";
import type {
  Annotation,
  Artifact,
  Identity,
  ReviewSession,
  VerdictKind,
  WorkspaceKey,
} from "@cueloop/schema";
import { BackpressureWriter, LineBuffer, type EventFrame, type Response } from "./protocol";
import type { DaemonRole } from "./capabilities";
import type { HerdrTabHandle } from "./herdr-tab-store";
import { cueloopHome, socketPath } from "./paths";

export type { EventFrame } from "./protocol";

export interface ConnectOptions {
  home?: string;
  /** Spawn the daemon when the socket is not alive. */
  autostart?: boolean;
  /** Capability role for this connection; a review-side agent connects capped. Defaults to owner. */
  role?: DaemonRole;
}

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * The session verbs the review controller drives. DaemonClient is the local
 * implementation (unix socket); the sharing gateway supplies an in-memory,
 * blob-backed one. Depending on this interface - not DaemonClient - is what
 * lets the same <App> render a local session or a decrypted share unchanged.
 */
export interface SessionClient {
  onEvent(listener: (event: EventFrame) => void): () => void;
  subscribe(): Promise<void>;
  sessionGet(id: string): Promise<ReviewSession>;
  sessionList(filter?: { status?: "pending" | "resolved" }): Promise<ReviewSession[]>;
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<ReviewSession>;
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<ReviewSession>;
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<ReviewSession>;
  sessionSetViewed(id: string, viewedPaths: string[]): Promise<ReviewSession>;
  sessionSetShareId(id: string, shareId: string): Promise<ReviewSession>;
  sessionMergeShared(
    id: string,
    incoming: { annotations: Annotation[]; participants?: Identity[] },
  ): Promise<ReviewSession>;
  sessionDelete(id: string): Promise<void>;
  /** Record the caller's own identity name (collaborator self-naming on a share). */
  sessionSetSelfName(id: string, name: string): Promise<ReviewSession>;
  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): Promise<ReviewSession>;
  close(): void;
}

export class DaemonClient implements SessionClient {
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private writer: BackpressureWriter | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private eventListeners = new Set<(event: EventFrame) => void>();
  private closed = false;
  private role: DaemonRole = "owner";

  static async connect(options: ConnectOptions = {}): Promise<DaemonClient> {
    const home = options.home ?? cueloopHome();
    const path = socketPath(home);
    const client = new DaemonClient();

    client.role = options.role ?? "owner";
    try {
      await client.dial(path);

      return client;
    } catch (err) {
      if (!options.autostart) throw err;
    }
    // Socket dead or absent: clean a stale file and spawn the daemon detached.
    if (existsSync(path)) rmSync(path, { force: true });
    spawnDaemon(home);
    // Generous: a cold or loaded machine pays for a runtime start before the
    // socket exists, and giving up early looks to callers like a broken daemon.
    const deadline = Date.now() + Number(process.env.CUELOOP_START_TIMEOUT_MS ?? 30_000);
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        await client.dial(path);

        return client;
      } catch (err) {
        lastError = err;
        await Bun.sleep(50);
      }
    }
    throw new Error(`daemon did not come up at ${path}: ${String(lastError)}`);
  }

  private async dial(path: string): Promise<void> {
    const buffer = new LineBuffer();

    this.socket = await Bun.connect({
      unix: path,
      socket: {
        data: (_socket, data) => {
          buffer.push(data.toString(), (line) => this.routeInboundFrame(line));
        },
        drain: () => {
          this.writer?.drain();
        },
        close: () => {
          this.closed = true;
          for (const pendingRequest of this.pending.values())
            pendingRequest.reject(new Error("daemon connection closed"));
          this.pending.clear();
        },
        error() {},
      },
    });
    this.writer = new BackpressureWriter(this.socket);
    // Verify liveness: a dead socket file accepts connects on some platforms
    // only to fail later, so a ping is the actual handshake.
    await this.request("daemon.ping", {}, 2_000);
    // Cap this connection's role for the daemon's capability gate (owner is the default).
    if (this.role !== "owner") await this.request("daemon.hello", { role: this.role }, 2_000);
  }

  onEvent(listener: (event: EventFrame) => void): () => void {
    this.eventListeners.add(listener);

    return () => this.eventListeners.delete(listener);
  }

  private routeInboundFrame(line: string): void {
    let frame: Response | EventFrame;

    try {
      frame = JSON.parse(line) as Response | EventFrame;
    } catch {
      return;
    }
    if ("event" in frame) {
      for (const listener of this.eventListeners) listener(frame);

      return;
    }
    const pendingRequest = this.pending.get(frame.id);

    if (!pendingRequest) return;
    this.pending.delete(frame.id);
    if (frame.error)
      pendingRequest.reject(new DaemonClientError(frame.error.code, frame.error.message));
    else pendingRequest.resolve(frame.result);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closed || !this.socket) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.writer!.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  close(): void {
    this.closed = true;
    this.socket?.end();
  }

  // ── typed verbs ─────────────────────────────
  ping(): Promise<{ pid: number }> {
    return this.request("daemon.ping", {});
  }
  subscribe(): Promise<void> {
    return this.request("events.subscribe", {});
  }
  sessionCreate(workspace: WorkspaceKey, artifact: Artifact): Promise<ReviewSession> {
    return this.request("session.create", { workspace, artifact });
  }
  sessionGet(id: string): Promise<ReviewSession> {
    return this.request("session.get", { id });
  }
  sessionList(filter?: { status?: "pending" | "resolved" }): Promise<ReviewSession[]> {
    return this.request("session.list", { filter });
  }
  /** Long-poll; null = still pending after timeoutMs (re-poll to collect). */
  sessionWait(id: string, timeoutMs: number): Promise<ReviewSession | null> {
    return this.request("session.wait", { id, timeoutMs }, timeoutMs + 10_000);
  }
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<ReviewSession> {
    return this.request("session.annotate", { id, annotation, authorName });
  }
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<ReviewSession> {
    return this.request("session.removeAnnotation", { id, annotationId });
  }
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<ReviewSession> {
    return this.request("session.setWorkingCopy", { id, workingCopy });
  }
  sessionSetViewed(id: string, viewedPaths: string[]): Promise<ReviewSession> {
    return this.request("session.setViewed", { id, viewedPaths });
  }
  /** Re-capture a diff session's working tree; changed=true when the patch moved and an event fired. */
  sessionRefreshDiff(id: string): Promise<{ changed: boolean }> {
    return this.request("session.refreshDiff", { id });
  }
  sessionSetShareId(id: string, shareId: string): Promise<ReviewSession> {
    return this.request("session.setShareId", { id, shareId });
  }
  sessionMergeShared(
    id: string,
    incoming: { annotations: Annotation[]; participants?: Identity[] },
  ): Promise<ReviewSession> {
    return this.request("session.mergeShared", { id, ...incoming });
  }
  sessionDelete(id: string): Promise<void> {
    return this.request("session.delete", { id });
  }
  /** Local sessions have no collaborator self-name; the share client owns this. */
  sessionSetSelfName(id: string, _name: string): Promise<ReviewSession> {
    return this.sessionGet(id);
  }
  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): Promise<ReviewSession> {
    return this.request("session.resolve", { id, verdictKind, summary });
  }
  sessionSubmitRevision(
    id: string,
    content: string,
    addressedAnnotationIds: string[] = [],
  ): Promise<ReviewSession> {
    return this.request("session.submitRevision", { id, content, addressedAnnotationIds });
  }
  /** herdr adapter scratch: the tab opened for a review; local-only, off the SessionClient contract. */
  herdrGetTab(id: string): Promise<HerdrTabHandle | null> {
    return this.request("herdr.getTab", { id });
  }
  async herdrSetTab(id: string, handle: HerdrTabHandle): Promise<void> {
    await this.request("herdr.setTab", { id, ...handle });
  }
  shutdown(): Promise<void> {
    return this.request("daemon.shutdown", {});
  }
}

export class DaemonClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function spawnDaemon(home: string): void {
  const entry = new URL("./main.ts", import.meta.url).pathname;

  Bun.spawn([process.execPath, "run", entry], {
    env: { ...process.env, CUELOOP_HOME: home },
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}
