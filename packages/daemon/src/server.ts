/**
 * The socket server: binds DaemonCore's methods to the unix socket, owns the
 * pidfile, stale-socket cleanup, and the idle-exit timer (#14). File
 * permissions are the local auth: the socket and state dir are 0700/0600.
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { DaemonCore, DaemonError, type DaemonEvent } from "./api";
import { LineBuffer, type Request } from "./protocol";
import { cueloopHome, pidPath, socketPath } from "./paths";

interface Conn {
  write(data: string): void;
  subscribed: boolean;
}

export interface DaemonOptions {
  home?: string;
  /** Idle-exit delay; 0 disables (tests, foreground runs). */
  idleExitMs?: number;
  onIdleExit?: () => void;
}

export class DaemonServer {
  readonly core: DaemonCore;
  readonly home: string;
  private conns = new Set<Conn>();
  private server: ReturnType<typeof Bun.listen> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleExitMs: number;
  private readonly onIdleExit: () => void;

  constructor(opts: DaemonOptions = {}) {
    this.home = opts.home ?? cueloopHome();
    this.idleExitMs = opts.idleExitMs ?? 15 * 60 * 1000;
    this.onIdleExit = opts.onIdleExit ?? (() => process.exit(0));
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    this.core = new DaemonCore(this.home);
    this.core.onEvent((e) => this.broadcast(e));
  }

  start(): string {
    const path = socketPath(this.home);
    if (existsSync(path)) rmSync(path); // liveness is checked by the launcher before start
    const self = this;
    this.server = Bun.listen<{ buffer: LineBuffer; conn: Conn }>({
      unix: path,
      socket: {
        open(socket) {
          const conn: Conn = { write: (d) => socket.write(d), subscribed: false };
          socket.data = { buffer: new LineBuffer(), conn };
          self.conns.add(conn);
          self.scheduleIdleCheck();
        },
        data(socket, data) {
          socket.data.buffer.push(data.toString(), (line) => {
            void self.handleLine(socket.data.conn, line);
          });
        },
        close(socket) {
          self.conns.delete(socket.data.conn);
          self.scheduleIdleCheck();
        },
        error() {},
      },
    });
    chmodSync(path, 0o600);
    writeFileSync(pidPath(this.home), String(process.pid));
    this.scheduleIdleCheck();
    return path;
  }

  stop(): void {
    this.server?.stop(true);
    rmSync(socketPath(this.home), { force: true });
    rmSync(pidPath(this.home), { force: true });
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  private broadcast(e: DaemonEvent): void {
    const frame = JSON.stringify(e) + "\n";
    for (const c of this.conns) if (c.subscribed) c.write(frame);
    this.scheduleIdleCheck();
  }

  /** Idle = no pending session and no attached client. */
  private scheduleIdleCheck(): void {
    if (this.idleExitMs <= 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.conns.size === 0 && !this.core.hasPendingSessions()) {
        this.stop();
        this.onIdleExit();
      } else {
        this.scheduleIdleCheck();
      }
    }, this.idleExitMs);
  }

  private async handleLine(conn: Conn, line: string): Promise<void> {
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      conn.write(JSON.stringify({ id: -1, error: { code: "bad_json", message: "unparseable request" } }) + "\n");
      return;
    }
    try {
      const result = await this.dispatch(conn, req);
      conn.write(JSON.stringify({ id: req.id, result }) + "\n");
    } catch (err) {
      const code = err instanceof DaemonError ? err.code : "internal";
      const message = err instanceof Error ? err.message : String(err);
      conn.write(JSON.stringify({ id: req.id, error: { code, message } }) + "\n");
    }
  }

  private async dispatch(conn: Conn, req: Request): Promise<unknown> {
    const p = (req.params ?? {}) as Record<string, never>;
    const core = this.core;
    switch (req.method) {
      case "daemon.ping":
        return { pid: process.pid };
      case "daemon.shutdown":
        setTimeout(() => {
          this.stop();
          this.onIdleExit();
        }, 10);
        return {};
      case "events.subscribe":
        conn.subscribed = true;
        return {};
      case "session.create":
        return core.sessionCreate(p);
      case "session.get":
        return core.sessionGet(p["id"]);
      case "session.list":
        return core.sessionList(p["filter"]);
      case "session.wait":
        return core.sessionWait(p["id"], p["timeoutMs"] ?? 60_000);
      case "session.annotate":
        return core.sessionAnnotate(p["id"], p["annotation"]);
      case "session.removeAnnotation":
        return core.sessionRemoveAnnotation(p["id"], p["annotationId"]);
      case "session.setWorkingCopy":
        return core.sessionSetWorkingCopy(p["id"], p["workingCopy"]);
      case "session.resolve":
        return core.sessionResolve(p["id"], p["verdictKind"], p["summary"] ?? "");
      case "session.submitRevision":
        return core.sessionSubmitRevision(p["id"], p["content"]);
      default:
        throw new DaemonError("unknown_method", `unknown method ${req.method}`);
    }
  }
}
