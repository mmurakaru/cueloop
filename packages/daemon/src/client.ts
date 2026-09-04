/**
 * Daemon client: the one library every consumer shares - CLI primitives, the TUI,
 * adapters, and tests. Also owns the lazy-launch story: connect() with
 * autostart spawns a detached daemon when the socket is dead, then attaches.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import * as v from "valibot";
import type {
  Annotation,
  Artifact,
  HunkRejection,
  ReviewSession,
  VerdictKind,
  WorkspaceKey,
} from "@cueloop/schema";
import {
  BackpressureWriter,
  LineBuffer,
  parseInboundFrame,
  type EventFrame,
  type Request,
  type Response,
} from "./protocol";
import type { DaemonRole } from "./capabilities";
import type { HerdrTabHandle } from "./herdr-tab-store";
import type { SharedMerge } from "./api";

export type { SharedMerge } from "./api";
import { cueloopHome, ownerTokenPath, socketPath } from "./paths";
import { Params, SessionRecordSchema } from "./validate";

export type { EventFrame } from "./protocol";

export interface ConnectOptions {
  home?: string;
  /** Spawn the daemon when the socket is not alive. */
  autostart?: boolean;
  /** Capability role for this connection; a review-side agent connects capped. Defaults to owner. */
  role?: DaemonRole;
  /** The author a non-owner connection acts as; its comments, removals, and name are bound to it. */
  author?: string;
}

type PendingRequest = {
  resolve: (value: Response["result"]) => void;
  reject: (error: Error) => void;
};

const EmptyResultSchema = v.object({});
const PingResultSchema = v.object({ pid: v.number() });
const RefreshDiffResultSchema = v.object({ changed: v.boolean() });
const HerdrTabResultSchema = v.nullable(v.object({ tabId: v.string(), paneId: v.string() }));

/**
 * The session primitives the review controller drives. DaemonClient is the local
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
  /** Remove a comment; a non-owner connection removes only the comments of the author it is bound to. */
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<ReviewSession>;
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<ReviewSession>;
  /** Cut the `blockIndex`-th block of the working copy. */
  sessionCutBlock(id: string, blockIndex: number): Promise<ReviewSession>;
  /** Re-insert the `baseBlockIndex`-th block of the submitted revision before `line` (default: the end). */
  sessionRestoreBlock(id: string, baseBlockIndex: number, line?: number): Promise<ReviewSession>;
  /** Replace a diff review's reject decisions; the working copy follows. */
  sessionCurate(id: string, rejections: HunkRejection[]): Promise<ReviewSession>;
  sessionSetViewed(id: string, viewedPaths: string[]): Promise<ReviewSession>;
  /** Move a branch's tip (the current one, or `branch` after switching to it) back to an entry on its path; a summary records the abandoned segment. */
  sessionNavigate(
    id: string,
    entryId: string,
    summary?: string,
    branch?: string,
  ): Promise<ReviewSession>;
  /** Start a branch at the current tip and switch to it. */
  sessionBranch(id: string, name: string): Promise<ReviewSession>;
  sessionSwitch(id: string, branch: string): Promise<ReviewSession>;
  /** Name the current tip as a checkpoint. */
  sessionLabel(id: string, label: string): Promise<ReviewSession>;
  /** Copy the current path into a new session; returns the fork. */
  sessionFork(id: string): Promise<ReviewSession>;
  sessionSetShareId(id: string, shareId: string): Promise<ReviewSession>;
  sessionMergeShared(id: string, incoming: SharedMerge): Promise<ReviewSession>;
  sessionDelete(id: string): Promise<void>;
  /** Record the caller's own identity name (collaborator self-naming on a share). */
  sessionSetSelfName(id: string, name: string): Promise<ReviewSession>;
  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): Promise<ReviewSession>;
  close(): void;
}

/** What a connection says about itself: its role, the owner token when it claims ownership, the author it acts as otherwise. */
interface HelloParams {
  role: DaemonRole;
  token?: string;
  author?: string;
}

/** The token as the daemon writes it: 32 random bytes in hex. */
const OwnerTokenSchema = v.pipe(v.string(), v.trim(), v.regex(/^[0-9a-f]{64}$/));

/** The owner token in `home`, or undefined when the daemon there never wrote one. */
function readOwnerToken(home: string): string | undefined {
  const path = ownerTokenPath(home);

  if (!existsSync(path)) return undefined;
  const parsed = v.safeParse(OwnerTokenSchema, readFileSync(path, "utf8"));

  if (!parsed.success) {
    throw new DaemonClientError(
      "invalid_owner_token",
      `${path} is not an owner token; restart the daemon to mint a fresh one`,
    );
  }

  return parsed.output;
}

export class DaemonClient implements SessionClient {
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private writer: BackpressureWriter | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private eventListeners = new Set<(event: EventFrame) => void>();
  private closed = false;
  private role: DaemonRole = "owner";
  private author: string | undefined;
  private home = cueloopHome();

  static async connect(options: ConnectOptions = {}): Promise<DaemonClient> {
    const home = options.home ?? cueloopHome();
    const path = socketPath(home);
    const client = new DaemonClient();

    client.role = options.role ?? "owner";
    client.author = options.author;
    client.home = home;
    try {
      await client.dial(path);

      return client;
    } catch (err) {
      // a live daemon that refused the handshake is not a dead socket: the
      // caller hears why instead of the client replacing a running daemon
      if (!options.autostart || err instanceof DaemonClientError) throw err;
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
    await this.request("daemon.ping", {}, PingResultSchema, 2_000);
    // Every connection starts as a collaborator; the owner proves itself with
    // the token the daemon wrote into the home it serves, which only the home's
    // user can read. A capped role just names itself.
    await this.request("daemon.hello", this.helloParams(), EmptyResultSchema, 2_000);
  }

  private helloParams(): HelloParams {
    if (this.role !== "owner") {
      return this.author === undefined
        ? { role: this.role }
        : { role: this.role, author: this.author };
    }
    const token = readOwnerToken(this.home);

    // a daemon from before owner tokens has no file; it still knows the bare hello
    return token === undefined ? { role: "owner" } : { role: "owner", token };
  }

  onEvent(listener: (event: EventFrame) => void): () => void {
    this.eventListeners.add(listener);

    return () => this.eventListeners.delete(listener);
  }

  private routeInboundFrame(line: string): void {
    let frame;

    try {
      frame = parseInboundFrame(line);
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

  request<TOutput>(
    method: string,
    params: Request["params"],
    resultSchema: v.GenericSchema<unknown, TOutput>,
    timeoutMs = 30_000,
  ): Promise<TOutput> {
    if (this.closed || !this.socket) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;

    return new Promise<TOutput>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(v.parse(resultSchema, value));
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

  // ── typed primitives ─────────────────────────────
  ping(): Promise<{ pid: number }> {
    return this.request("daemon.ping", {}, PingResultSchema);
  }
  subscribe(): Promise<void> {
    return this.request("events.subscribe", {}, EmptyResultSchema).then(() => undefined);
  }
  sessionCreate(workspace: WorkspaceKey, artifact: Artifact): Promise<ReviewSession> {
    return this.request("session.create", { workspace, artifact }, SessionRecordSchema);
  }
  sessionGet(id: string): Promise<ReviewSession> {
    return this.request("session.get", { id }, SessionRecordSchema);
  }
  sessionList(filter?: { status?: "pending" | "resolved" }): Promise<ReviewSession[]> {
    return this.request("session.list", { filter }, v.array(SessionRecordSchema));
  }
  /** Long-poll; null = still pending after timeoutMs (re-poll to collect). */
  sessionWait(id: string, timeoutMs: number): Promise<ReviewSession | null> {
    return this.request(
      "session.wait",
      { id, timeoutMs },
      v.nullable(SessionRecordSchema),
      timeoutMs + 10_000,
    );
  }
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<ReviewSession> {
    return this.request("session.annotate", { id, annotation, authorName }, SessionRecordSchema);
  }
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<ReviewSession> {
    return this.request("session.removeAnnotation", { id, annotationId }, SessionRecordSchema);
  }
  /** Register a display name for a participant - a collaborator's or an agent's own, on a share or locally. */
  sessionSetParticipantName(id: string, author: string, name: string): Promise<ReviewSession> {
    return this.request("session.setParticipantName", { id, author, name }, SessionRecordSchema);
  }
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<ReviewSession> {
    return this.request("session.setWorkingCopy", { id, workingCopy }, SessionRecordSchema);
  }
  sessionCutBlock(id: string, blockIndex: number): Promise<ReviewSession> {
    return this.request("session.cutBlock", { id, blockIndex }, SessionRecordSchema);
  }
  sessionNavigate(
    id: string,
    entryId: string,
    summary?: string,
    branch?: string,
  ): Promise<ReviewSession> {
    const params: v.InferInput<(typeof Params)["session.navigate"]> = { id, entryId };

    if (summary !== undefined) params.summary = summary;
    if (branch !== undefined) params.branch = branch;

    return this.request("session.navigate", params, SessionRecordSchema);
  }
  sessionBranch(id: string, name: string): Promise<ReviewSession> {
    return this.request("session.branch", { id, name }, SessionRecordSchema);
  }
  sessionSwitch(id: string, branch: string): Promise<ReviewSession> {
    return this.request("session.switch", { id, branch }, SessionRecordSchema);
  }
  sessionLabel(id: string, label: string): Promise<ReviewSession> {
    return this.request("session.label", { id, label }, SessionRecordSchema);
  }
  sessionFork(id: string): Promise<ReviewSession> {
    return this.request("session.fork", { id }, SessionRecordSchema);
  }
  sessionRestoreBlock(id: string, baseBlockIndex: number, line?: number): Promise<ReviewSession> {
    return this.request(
      "session.restoreBlock",
      line === undefined ? { id, baseBlockIndex } : { id, baseBlockIndex, line },
      SessionRecordSchema,
    );
  }
  sessionCurate(id: string, rejections: HunkRejection[]): Promise<ReviewSession> {
    return this.request("session.curate", { id, rejections }, SessionRecordSchema);
  }
  sessionSetViewed(id: string, viewedPaths: string[]): Promise<ReviewSession> {
    return this.request("session.setViewed", { id, viewedPaths }, SessionRecordSchema);
  }
  /** Re-capture a diff session's working tree; changed=true when the patch moved and an event fired. */
  sessionRefreshDiff(id: string): Promise<{ changed: boolean }> {
    return this.request("session.refreshDiff", { id }, RefreshDiffResultSchema);
  }
  sessionSetShareId(id: string, shareId: string): Promise<ReviewSession> {
    return this.request("session.setShareId", { id, shareId }, SessionRecordSchema);
  }
  sessionMergeShared(id: string, incoming: SharedMerge): Promise<ReviewSession> {
    return this.request("session.mergeShared", { id, ...incoming }, SessionRecordSchema);
  }
  sessionDelete(id: string): Promise<void> {
    return this.request("session.delete", { id }, EmptyResultSchema).then(() => undefined);
  }
  /** Local sessions have no collaborator self-name; the share client owns this. */
  sessionSetSelfName(id: string, _name: string): Promise<ReviewSession> {
    return this.sessionGet(id);
  }
  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): Promise<ReviewSession> {
    return this.request("session.resolve", { id, verdictKind, summary }, SessionRecordSchema);
  }
  sessionSubmitRevision(
    id: string,
    content: string,
    addressedAnnotationIds: string[] = [],
  ): Promise<ReviewSession> {
    return this.request(
      "session.submitRevision",
      { id, content, addressedAnnotationIds },
      SessionRecordSchema,
    );
  }
  /** herdr adapter scratch: the tab opened for a review; local-only, off the SessionClient contract. */
  herdrGetTab(id: string): Promise<HerdrTabHandle | null> {
    return this.request("herdr.getTab", { id }, HerdrTabResultSchema);
  }
  async herdrSetTab(id: string, handle: HerdrTabHandle): Promise<void> {
    await this.request("herdr.setTab", { id, ...handle }, EmptyResultSchema);
  }
  shutdown(): Promise<void> {
    return this.request("daemon.shutdown", {}, EmptyResultSchema).then(() => undefined);
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

// A compiled binary re-execs `cueloop daemon --autostart` (idle-exits like main.ts,
// unlike the never-exiting foreground daemon); from source, bun runs main.ts.
export function daemonSpawnCommand(execPath: string, moduleUrl: string): string[] {
  const compiled =
    moduleUrl.includes("$bunfs") || moduleUrl.includes("~BUN") || moduleUrl.includes("%7EBUN");

  return compiled
    ? [execPath, "daemon", "--autostart"]
    : [execPath, "run", new URL("./main.ts", moduleUrl).pathname];
}

function spawnDaemon(home: string): void {
  Bun.spawn(daemonSpawnCommand(process.execPath, import.meta.url), {
    env: { ...process.env, CUELOOP_HOME: home },
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}
