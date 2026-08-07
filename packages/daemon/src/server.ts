/**
 * The socket server: binds DaemonCore's methods to the unix socket, owns the
 * pidfile, stale-socket cleanup, and the idle-exit timer (#14). File
 * permissions are the local auth: the socket and state dir are 0700/0600.
 */

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DaemonCore, type DaemonEvent } from "./api";
import { DaemonError } from "./errors";
import { isKnownMethod, parseParams } from "./validate";
import { LineBuffer, type Request } from "./protocol";
import { cueloopHome, lockPath, pidPath, socketPath } from "./paths";

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

/**
 * Homes locked by a DaemonServer in THIS process. The on-disk lock's pid check
 * cannot distinguish two instances inside one process (tests do exactly that),
 * so in-process ownership is tracked separately.
 */
const HELD_HOMES = new Set<string>();

export class DaemonServer {
  readonly core: DaemonCore;
  readonly home: string;
  private conns = new Set<Conn>();
  private server: ReturnType<typeof Bun.listen> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lockFd: number | null = null;
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

  /**
   * Exclusive single-instance lock over a cueloop home. Without it, two
   * concurrent autostarts both bind: the second unlinks the first's socket and
   * binds a fresh inode, leaving two daemons with divergent in-memory state
   * over the same session files - clients then see whichever half won the race.
   * Returns false when a live daemon already owns this home.
   */
  private acquireLock(): boolean {
    if (HELD_HOMES.has(this.home)) return false; // another instance here owns it
    const path = lockPath(this.home);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // "wx" fails when the file exists - the atomic part of the handshake
        const fd = openSync(path, "wx");
        writeFileSync(fd, String(process.pid));
        this.lockFd = fd;
        HELD_HOMES.add(this.home);
        return true;
      } catch {
        let ownerPid = 0;
        try {
          ownerPid = Number(readFileSync(path, "utf8").trim());
        } catch {
          // the owner vanished between open and read; retry
          continue;
        }
        if (ownerPid && ownerPid !== process.pid) {
          try {
            process.kill(ownerPid, 0); // throws when the pid is gone
            return false; // a live daemon owns this home
          } catch {
            // stale lock from a crashed daemon
          }
        }
        // ownerPid === our pid but HELD_HOMES says we do not own it: a stale
        // file from an earlier instance in this process - reclaim it.
        try {
          rmSync(path, { force: true });
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  private releaseLock(): void {
    HELD_HOMES.delete(this.home);
    if (this.lockFd !== null) {
      try {
        closeSync(this.lockFd);
      } catch {
        // already closed
      }
      this.lockFd = null;
    }
    rmSync(lockPath(this.home), { force: true });
  }

  /**
   * Bind the socket and serve. Returns null when another live daemon already
   * owns this home - the caller should attach to it instead of competing.
   */
  start(): string | null {
    if (!this.acquireLock()) return null;
    const path = socketPath(this.home);
    // safe now: holding the lock means no live daemon owns this home, so any
    // socket file left behind is stale
    if (existsSync(path)) rmSync(path, { force: true });
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
    this.server = null;
    rmSync(socketPath(this.home), { force: true });
    rmSync(pidPath(this.home), { force: true });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.releaseLock();
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
    // The wire is untrusted JSON: validate before DaemonCore sees anything.
    if (typeof req.method !== "string" || !isKnownMethod(req.method)) {
      throw new DaemonError("unknown_method", `unknown method ${String(req.method)}`);
    }
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
      case "session.create": {
        const p = parseParams("session.create", req.params);
        return core.sessionCreate({ workspace: p.workspace, artifact: p.artifact });
      }
      case "session.get":
        return core.sessionGet(parseParams("session.get", req.params).id);
      case "session.list":
        return core.sessionList(parseParams("session.list", req.params).filter);
      case "session.wait": {
        const p = parseParams("session.wait", req.params);
        return core.sessionWait(p.id, p.timeoutMs);
      }
      case "session.annotate": {
        const p = parseParams("session.annotate", req.params);
        return core.sessionAnnotate(p.id, p.annotation);
      }
      case "session.removeAnnotation": {
        const p = parseParams("session.removeAnnotation", req.params);
        return core.sessionRemoveAnnotation(p.id, p.annotationId);
      }
      case "session.setWorkingCopy": {
        const p = parseParams("session.setWorkingCopy", req.params);
        return core.sessionSetWorkingCopy(p.id, p.workingCopy);
      }
      case "session.resolve": {
        const p = parseParams("session.resolve", req.params);
        return core.sessionResolve(p.id, p.verdictKind, p.summary);
      }
      case "session.submitRevision": {
        const p = parseParams("session.submitRevision", req.params);
        return core.sessionSubmitRevision(p.id, p.content);
      }
      default:
        throw new DaemonError("unknown_method", `unknown method ${req.method}`);
    }
  }
}
