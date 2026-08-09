/**
 * Daemon client: the one library every consumer shares - CLI verbs, the TUI,
 * adapters, and tests. Also owns the lazy-launch story (#14): connect() with
 * autostart spawns a detached daemon when the socket is dead, then attaches.
 */

import { existsSync, rmSync } from "node:fs";
import type { Annotation, Artifact, ReviewSession, VerdictKind, WorkspaceKey } from "@cueloop/schema";
import { BackpressureWriter, LineBuffer, type EventFrame, type Response } from "./protocol";
import { cueloopHome, socketPath } from "./paths";

export interface ConnectOptions {
  home?: string;
  /** Spawn the daemon when the socket is not alive. */
  autostart?: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class DaemonClient {
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private writer: BackpressureWriter | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private eventListeners = new Set<(e: EventFrame) => void>();
  private closed = false;

  static async connect(opts: ConnectOptions = {}): Promise<DaemonClient> {
    const home = opts.home ?? cueloopHome();
    const path = socketPath(home);
    const client = new DaemonClient();
    try {
      await client.dial(path);
      return client;
    } catch (err) {
      if (!opts.autostart) throw err;
    }
    // Socket dead or absent: clean a stale file and spawn the daemon detached.
    if (existsSync(path)) rmSync(path, { force: true });
    spawnDaemon(home);
    // Generous: a cold or loaded machine pays for a runtime start before the
    // socket exists, and giving up early looks to callers like a broken daemon.
    const deadline = Date.now() + Number(process.env.CUELOOP_START_TIMEOUT_MS ?? 30_000);
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        await client.dial(path);
        return client;
      } catch (err) {
        lastErr = err;
        await Bun.sleep(50);
      }
    }
    throw new Error(`daemon did not come up at ${path}: ${String(lastErr)}`);
  }

  private async dial(path: string): Promise<void> {
    const buffer = new LineBuffer();
    const self = this;
    this.socket = await Bun.connect({
      unix: path,
      socket: {
        data(_socket, data) {
          buffer.push(data.toString(), (line) => self.handleFrame(line));
        },
        drain() {
          self.writer?.drain();
        },
        close() {
          self.closed = true;
          for (const p of self.pending.values()) p.reject(new Error("daemon connection closed"));
          self.pending.clear();
        },
        error() {},
      },
    });
    this.writer = new BackpressureWriter(this.socket);
    // Verify liveness: a dead socket file accepts connects on some platforms
    // only to fail later, so a ping is the actual handshake.
    await this.request("daemon.ping", {}, 2_000);
  }

  onEvent(listener: (e: EventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private handleFrame(line: string): void {
    let frame: Response | EventFrame;
    try {
      frame = JSON.parse(line) as Response | EventFrame;
    } catch {
      return;
    }
    if ("event" in frame) {
      for (const l of this.eventListeners) l(frame);
      return;
    }
    const p = this.pending.get(frame.id);
    if (!p) return;
    this.pending.delete(frame.id);
    if (frame.error) p.reject(new DaemonClientError(frame.error.code, frame.error.message));
    else p.resolve(frame.result);
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
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
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
  sessionAnnotate(id: string, annotation: Omit<Annotation, "createdAt">): Promise<ReviewSession> {
    return this.request("session.annotate", { id, annotation });
  }
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<ReviewSession> {
    return this.request("session.removeAnnotation", { id, annotationId });
  }
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<ReviewSession> {
    return this.request("session.setWorkingCopy", { id, workingCopy });
  }
  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): Promise<ReviewSession> {
    return this.request("session.resolve", { id, verdictKind, summary });
  }
  sessionSubmitRevision(id: string, content: string): Promise<ReviewSession> {
    return this.request("session.submitRevision", { id, content });
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
