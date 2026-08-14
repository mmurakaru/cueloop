/**
 * The socket server: binds DaemonCore's methods to the unix socket, owns the
 * pidfile, stale-socket cleanup, and the idle-exit timer. File
 * permissions are the local auth: the socket and state dir are 0700/0600.
 */

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DaemonCore, type DaemonEvent } from "./api";
import { DaemonError } from "./errors";
import { isKnownMethod, parseParams } from "./validate";
import { BackpressureWriter, LineBuffer, type Request } from "./protocol";
import { cueloopHome, lockPath, pidPath, socketPath } from "./paths";

interface Connection {
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
  private connections = new Set<Connection>();
  private server: ReturnType<typeof Bun.listen> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lockFd: number | null = null;
  private readonly idleExitMs: number;
  private readonly onIdleExit: () => void;

  constructor(options: DaemonOptions = {}) {
    this.home = options.home ?? cueloopHome();
    this.idleExitMs = options.idleExitMs ?? 15 * 60 * 1000;
    this.onIdleExit = options.onIdleExit ?? (() => process.exit(0));
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    this.core = new DaemonCore(this.home);
    this.core.onEvent((event) => this.broadcast(event));
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
    this.server = Bun.listen<{ buffer: LineBuffer; connection: Connection; writer: BackpressureWriter }>({
      unix: path,
      socket: {
        open(socket) {
          const writer = new BackpressureWriter(socket);
          const connection: Connection = { write: (data) => writer.write(data), subscribed: false };
          socket.data = { buffer: new LineBuffer(), connection, writer };
          self.connections.add(connection);
          self.scheduleIdleCheck();
        },
        data(socket, data) {
          socket.data.buffer.push(data.toString(), (line) => {
            void self.respondToRequestLine(socket.data.connection, line);
          });
        },
        drain(socket) {
          // drain can fire before open has attached data on some platforms;
          // a throw here would take the whole daemon down with the socket
          socket.data?.writer.drain();
        },
        close(socket) {
          self.connections.delete(socket.data.connection);
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

  private broadcast(event: DaemonEvent): void {
    const frame = JSON.stringify(event) + "\n";
    for (const connection of this.connections) if (connection.subscribed) connection.write(frame);
    this.scheduleIdleCheck();
  }

  /** Idle = no pending session and no attached client. */
  private scheduleIdleCheck(): void {
    if (this.idleExitMs <= 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.connections.size === 0 && !this.core.hasPendingSessions()) {
        this.stop();
        this.onIdleExit();
      } else {
        this.scheduleIdleCheck();
      }
    }, this.idleExitMs);
  }

  private async respondToRequestLine(connection: Connection, line: string): Promise<void> {
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      connection.write(JSON.stringify({ id: -1, error: { code: "bad_json", message: "unparseable request" } }) + "\n");
      return;
    }
    try {
      const result = await this.dispatch(connection, request);
      connection.write(JSON.stringify({ id: request.id, result }) + "\n");
    } catch (err) {
      const code = err instanceof DaemonError ? err.code : "internal";
      const message = err instanceof Error ? err.message : String(err);
      connection.write(JSON.stringify({ id: request.id, error: { code, message } }) + "\n");
    }
  }

  private async dispatch(connection: Connection, request: Request): Promise<unknown> {
    // The wire is untrusted JSON: validate before DaemonCore sees anything.
    if (typeof request.method !== "string" || !isKnownMethod(request.method)) {
      throw new DaemonError("unknown_method", `unknown method ${String(request.method)}`);
    }
    const core = this.core;
    switch (request.method) {
      case "daemon.ping":
        return { pid: process.pid };
      case "daemon.shutdown":
        setTimeout(() => {
          this.stop();
          this.onIdleExit();
        }, 10);
        return {};
      case "events.subscribe":
        connection.subscribed = true;
        return {};
      case "session.create": {
        const params = parseParams("session.create", request.params);
        return core.sessionCreate({ workspace: params.workspace, artifact: params.artifact });
      }
      case "session.get":
        return core.sessionGet(parseParams("session.get", request.params).id);
      case "session.list":
        return core.sessionList(parseParams("session.list", request.params).filter);
      case "session.wait": {
        const params = parseParams("session.wait", request.params);
        return core.sessionWait(params.id, params.timeoutMs);
      }
      case "session.annotate": {
        const params = parseParams("session.annotate", request.params);
        return core.sessionAnnotate(params.id, params.annotation);
      }
      case "session.removeAnnotation": {
        const params = parseParams("session.removeAnnotation", request.params);
        return core.sessionRemoveAnnotation(params.id, params.annotationId);
      }
      case "session.setWorkingCopy": {
        const params = parseParams("session.setWorkingCopy", request.params);
        return core.sessionSetWorkingCopy(params.id, params.workingCopy);
      }
      case "session.setViewed": {
        const params = parseParams("session.setViewed", request.params);
        return core.sessionSetViewed(params.id, params.viewedPaths);
      }
      case "session.resolve": {
        const params = parseParams("session.resolve", request.params);
        return core.sessionResolve(params.id, params.verdictKind, params.summary);
      }
      case "session.submitRevision": {
        const params = parseParams("session.submitRevision", request.params);
        return core.sessionSubmitRevision(params.id, params.content, params.addressedAnnotationIds);
      }
      default:
        throw new DaemonError("unknown_method", `unknown method ${request.method}`);
    }
  }
}
