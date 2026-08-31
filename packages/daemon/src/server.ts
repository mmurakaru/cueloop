/**
 * The socket server: binds DaemonCore's methods to the unix socket, owns the
 * pidfile, stale-socket cleanup, and the idle-exit timer. File
 * permissions are the local auth: the socket and state dir are 0700/0600.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DaemonCore, type DaemonEvent } from "./api";
import { DaemonError } from "./errors";
import { roleAllowsMethod, type DaemonRole } from "./capabilities";
import { isKnownMethod, parseParams, type MethodName } from "./validate";
import {
  BackpressureWriter,
  LineBuffer,
  parseRequestFrame,
  type Request,
  type Response,
} from "./protocol";
import { cueloopHome, lockPath, pidPath, socketPath } from "./paths";

interface Connection {
  write(data: string): void;
  subscribed: boolean;
  /** Capability role for this connection; the owner until a daemon.hello caps it. */
  role: DaemonRole;
}

type MethodHandler = (connection: Connection, request: Request) => Response["result"];

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
    this.server = Bun.listen<{
      buffer: LineBuffer;
      connection: Connection;
      writer: BackpressureWriter;
    }>({
      unix: path,
      socket: {
        open: (socket) => {
          const writer = new BackpressureWriter(socket);
          const connection: Connection = {
            write: (data) => writer.write(data),
            subscribed: false,
            role: "owner",
          };

          socket.data = { buffer: new LineBuffer(), connection, writer };
          this.connections.add(connection);
          this.scheduleIdleCheck();
        },
        data: (socket, data) => {
          socket.data.buffer.push(data.toString(), (line) => {
            void this.respondToRequestLine(socket.data.connection, line);
          });
        },
        drain(socket) {
          // drain can fire before open has attached data on some platforms;
          // a throw here would take the whole daemon down with the socket
          socket.data?.writer.drain();
        },
        close: (socket) => {
          this.connections.delete(socket.data.connection);
          this.scheduleIdleCheck();
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
    this.core.dispose();
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
      request = parseRequestFrame(line);
    } catch {
      connection.write(
        JSON.stringify({ id: -1, error: { code: "bad_json", message: "unparseable request" } }) +
          "\n",
      );

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

  private readonly handlers: Record<MethodName, MethodHandler> = {
    "daemon.ping": () => ({ pid: process.pid }),
    "daemon.hello": (connection, request) => {
      connection.role = parseParams("daemon.hello", request.params).role;

      return {};
    },
    "daemon.shutdown": () => {
      setTimeout(() => {
        this.stop();
        this.onIdleExit();
      }, 10);

      return {};
    },
    "events.subscribe": (connection) => {
      connection.subscribed = true;

      return {};
    },
    "session.create": (_connection, request) => {
      const params = parseParams("session.create", request.params);

      return this.core.sessionCreate({ workspace: params.workspace, artifact: params.artifact });
    },
    "session.get": (_connection, request) =>
      this.core.sessionGet(parseParams("session.get", request.params).id),
    "session.list": (_connection, request) =>
      this.core.sessionList(parseParams("session.list", request.params).filter),
    "session.wait": (_connection, request) => {
      const params = parseParams("session.wait", request.params);

      return this.core.sessionWait(params.id, params.timeoutMs);
    },
    "session.annotate": (_connection, request) => {
      const params = parseParams("session.annotate", request.params);

      return this.core.sessionAnnotate(params.id, params.annotation, params.authorName);
    },
    "session.removeAnnotation": (_connection, request) => {
      const params = parseParams("session.removeAnnotation", request.params);

      return this.core.sessionRemoveAnnotation(params.id, params.annotationId);
    },
    "session.setWorkingCopy": (_connection, request) => {
      const params = parseParams("session.setWorkingCopy", request.params);

      return this.core.sessionSetWorkingCopy(params.id, params.workingCopy);
    },
    "session.setViewed": (_connection, request) => {
      const params = parseParams("session.setViewed", request.params);

      return this.core.sessionSetViewed(params.id, params.viewedPaths);
    },
    "session.refreshDiff": (_connection, request) => {
      const params = parseParams("session.refreshDiff", request.params);

      return this.core.sessionRefreshDiff(params.id);
    },
    "session.setShareId": (_connection, request) => {
      const params = parseParams("session.setShareId", request.params);

      return this.core.sessionSetShareId(params.id, params.shareId);
    },
    "session.delete": (_connection, request) => {
      this.core.sessionDelete(parseParams("session.delete", request.params).id);

      return {};
    },
    "session.mergeShared": (_connection, request) => {
      const params = parseParams("session.mergeShared", request.params);

      return this.core.sessionMergeShared(params.id, {
        annotations: params.annotations,
        participants: params.participants,
      });
    },
    "session.resolve": (_connection, request) => {
      const params = parseParams("session.resolve", request.params);

      return this.core.sessionResolve(params.id, params.verdictKind, params.summary);
    },
    "session.submitRevision": (_connection, request) => {
      const params = parseParams("session.submitRevision", request.params);

      return this.core.sessionSubmitRevision(
        params.id,
        params.content,
        params.addressedAnnotationIds,
      );
    },
    "herdr.getTab": (_connection, request) =>
      this.core.herdrGetTab(parseParams("herdr.getTab", request.params).id),
    "herdr.setTab": (_connection, request) => {
      const params = parseParams("herdr.setTab", request.params);

      this.core.herdrSetTab(params.id, { tabId: params.tabId, paneId: params.paneId });

      return {};
    },
  };

  private async dispatch(connection: Connection, request: Request): Promise<Response["result"]> {
    // The wire is untrusted JSON: validate before DaemonCore sees anything.
    if (!isKnownMethod(request.method)) {
      throw new DaemonError("unknown_method", `unknown method ${request.method}`);
    }
    // Capability gate: a capped role (a review-side agent) cannot escalate past
    // read + annotate, whatever verb it sends.
    if (!roleAllowsMethod(connection.role, request.method)) {
      throw new DaemonError("forbidden", `role ${connection.role} cannot call ${request.method}`);
    }
    if (!Object.hasOwn(this.handlers, request.method)) {
      throw new DaemonError("unknown_method", `unknown method ${request.method}`);
    }

    return this.handlers[request.method](connection, request);
  }
}
