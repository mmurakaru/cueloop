/**
 * Daemon client: the one library every consumer shares - CLI primitives, the TUI,
 * adapters, and tests. Also owns the lazy-launch story: connect() with
 * autostart spawns a detached daemon when the socket is dead, then attaches.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import * as v from "valibot";
import type {
  Annotation,
  Artifact,
  DiffFileStatus,
  DiffFileContents,
  HunkRejection,
  ShareLink,
  Thread,
  HarnessBinding,
  Delivery,
  PendingDelivery,
  MessageOutcome,
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
import type { HerdrThreadSurfaceHandle } from "./herdr-thread-surface-store";
import type { GhosttyThreadSurfaceHandle } from "./ghostty-thread-surface-store";
import type { SharedMerge } from "./api";

export type { SharedMerge } from "./api";
import { cueloopHome, ownerTokenPath, socketPath } from "./paths";
import {
  Params,
  ThreadRecordSchema,
  DiffFileContentsSchema,
  HarnessBindingSchema,
  DeliverySchema,
  PendingDeliverySchema,
} from "./validate";
import type { WorkingTreeDiff } from "./working-tree";
import { DAEMON_VERSION } from "./version";

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
// version is optional: a daemon from before the handshake carried one reads as
// undefined, which never equals this build - so it is treated as stale and replaced
const PingResultSchema = v.object({ pid: v.number(), version: v.optional(v.string()) });
const RefreshDiffResultSchema = v.object({ changed: v.boolean() });
const HerdrThreadSurfaceResultSchema = v.nullable(
  v.object({
    tabId: v.string(),
    paneId: v.string(),
    mode: v.optional(v.picklist(["tab", "pane"])),
  }),
);
const GhosttyThreadSurfaceResultSchema = v.nullable(v.object({ terminalId: v.string() }));

/**
 * The session primitives the review controller drives. DaemonClient is the local
 * implementation (unix socket); the sharing gateway supplies an in-memory,
 * blob-backed one. Depending on this interface - not DaemonClient - is what
 * lets the same <App> render a local session or a decrypted share unchanged.
 */
export interface ThreadClient {
  onEvent(listener: (event: EventFrame) => void): () => void;
  subscribe(): Promise<void>;
  sessionGet(id: string): Promise<Thread>;
  sessionList(filter?: { status?: "pending" | "resolved" }): Promise<Thread[]>;
  /** Add a comment; the primary annotate method. `sessionAnnotate` is the retained alias. */
  sessionComment(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<Thread>;
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<Thread>;
  /** Remove a comment; a non-owner connection removes only the comments of the author it is bound to. */
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<Thread>;
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<Thread>;
  /** Cut the `blockIndex`-th block of the working copy. */
  sessionCutBlock(id: string, blockIndex: number): Promise<Thread>;
  /** Re-insert the `baseBlockIndex`-th block of the submitted revision before `line` (default: the end). */
  sessionRestoreBlock(id: string, baseBlockIndex: number, line?: number): Promise<Thread>;
  /** Replace a diff review's reject decisions; the working copy follows. */
  sessionCurate(id: string, rejections: HunkRejection[]): Promise<Thread>;
  /** Replace the private-share allowlist of GitHub logins; presence marks the share private. */
  sessionSetAccess(id: string, githubLogins: string[]): Promise<Thread>;
  sessionSetViewed(id: string, viewedPaths: string[]): Promise<Thread>;
  /** Rename a session's display title; an empty title restores the derived default. */
  sessionSetTitle(id: string, title: string): Promise<Thread>;
  /** Tracked, repo-relative file paths for the session's workspace; a client with no local repo (a share) omits it. */
  projectFiles?(sessionId: string): Promise<string[]>;
  /** UTF-8 contents of a repo-relative file, or null when it cannot be read safely; omitted by a client with no local repo. */
  fileContents?(sessionId: string, path: string): Promise<string | null>;
  /** Tracked, repo-relative paths for the git repo containing `cwd`, for the no-session welcome shell. */
  repoFiles?(cwd: string): Promise<string[]>;
  /** UTF-8 contents of a repo-relative file in `cwd`'s repo, or null when unreadable. */
  repoFileContents?(cwd: string, path: string): Promise<string | null>;
  /** Changed files (path plus git status) in the working tree at `cwd`. */
  repoChanges?(cwd: string): Promise<{ path: string; status: DiffFileStatus }[]>;
  /** The live working-tree diff (patch plus per-file contents) at `cwd`. */
  repoDiff?(cwd: string): Promise<WorkingTreeDiff>;
  /** Find-or-create the per-repo workbench thread for `cwd`, so a bare launch's first comment persists. */
  sessionWorkbench?(cwd: string): Promise<Thread>;
  /** Move a branch's tip (the current one, or `branch` after switching to it) back to an entry on its path; a summary records the abandoned segment. */
  sessionNavigate(id: string, entryId: string, summary?: string, branch?: string): Promise<Thread>;
  /** Start a branch at the current tip and switch to it. */
  sessionBranch(id: string, name: string): Promise<Thread>;
  sessionSwitch(id: string, branch: string): Promise<Thread>;
  /** Name the current tip as a checkpoint. */
  sessionLabel(id: string, label: string): Promise<Thread>;
  /** Copy the current path into a new session; returns the fork. */
  sessionFork(id: string): Promise<Thread>;
  sessionSetShareId(id: string, shareId: string): Promise<Thread>;
  sessionSetShares(id: string, shares: ShareLink[]): Promise<Thread>;
  sessionMergeShared(id: string, incoming: SharedMerge): Promise<Thread>;
  sessionDelete(id: string): Promise<void>;
  /** Record the caller's own identity name (collaborator self-naming on a share). */
  sessionSetSelfName(id: string, name: string): Promise<Thread>;
  sessionSendMessage(
    id: string,
    outcome: MessageOutcome,
    summary: string,
    actionBodies?: Record<string, string>,
  ): Promise<Thread>;
  harnessBind?(
    threadId: string,
    harness: string,
    harnessSessionId: string,
  ): Promise<HarnessBinding>;
  harnessGetBinding?(bindingId: string): Promise<HarnessBinding>;
  harnessBindingsForSession?(harness: string, harnessSessionId: string): Promise<HarnessBinding[]>;
  harnessConsumeApprovedRetry?(
    bindingId: string,
    messageId: string,
    content: string,
  ): Promise<boolean>;
  deliveryPending?(bindingId: string): Promise<PendingDelivery[]>;
  deliveryAcknowledge?(deliveryId: string): Promise<Delivery>;
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

export class DaemonClient implements ThreadClient {
  private socket: { end(): void } | null = null;
  private writer: BackpressureWriter | null = null;
  private connectionEpoch = 0;
  private pending = new Map<number, PendingRequest>();
  /** The connected daemon's build version and pid, learned from the ping handshake. */
  private daemonVersion: string | undefined;
  private daemonPid: number | undefined;
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
      // A daemon from an earlier build lingers after an upgrade; talking to it
      // means new client, old behaviour. The owner replaces it so an upgrade
      // never needs a manual restart; without autostart there is nothing to
      // replace it with, so the caller hears exactly why.
      if (client.daemonVersion === DAEMON_VERSION) return client;
      if (!options.autostart) {
        client.close();
        throw new DaemonClientError(
          "version_mismatch",
          `daemon is version ${client.daemonVersion ?? "unknown"}, but this client is ${DAEMON_VERSION}; restart the daemon`,
        );
      }
      await client.stopStaleDaemon(path);
    } catch (err) {
      // a live daemon that refused the handshake is not a dead socket: the
      // caller hears why instead of the client replacing a running daemon
      if (!options.autostart || err instanceof DaemonClientError) throw err;
    }
    // Socket dead, absent, or just-replaced: let the new daemon own socket cleanup.
    return client.attachFreshDaemon(home, path);
  }

  /**
   * Tear down a daemon from an earlier build so a fresh one can bind: ask it to
   * shut down (owner-gated) or, failing that, signal its pid, then wait for it to
   * release the socket. Best-effort - the next daemon reclaims stale socket
   * and lock files after it takes ownership.
   */
  private async stopStaleDaemon(path: string): Promise<void> {
    const pid = this.daemonPid;

    try {
      await this.request("daemon.shutdown", {}, EmptyResultSchema, 2_000);
    } catch {
      if (pid !== undefined) {
        try {
          process.kill(pid);
        } catch {}
      }
    }
    this.socket?.end();
    this.resetConnection();
    // the old daemon removes its socket in stop(); wait so the new one binds cleanly
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline && existsSync(path)) await sleep(50);
  }

  /** Reset per-connection state so a fresh dial() can reuse this client instance. */
  private resetConnection(): void {
    this.connectionEpoch += 1;
    this.socket = null;
    this.writer = null;
    this.closed = false;
    for (const pendingRequest of this.pending.values())
      pendingRequest.reject(new Error("daemon connection replaced"));
    this.pending.clear();
  }

  /** Spawn a detached daemon and dial the lock owner until it answers. */
  private async attachFreshDaemon(home: string, path: string): Promise<DaemonClient> {
    const startupLogPath = spawnDaemon(home);
    // Generous: a cold or loaded machine pays for a runtime start before the
    // socket exists, and giving up early looks to callers like a broken daemon.
    const deadline = Date.now() + Number(process.env.CUELOOP_START_TIMEOUT_MS ?? 30_000);
    let lastError: unknown;

    try {
      while (Date.now() < deadline) {
        try {
          await this.dial(path);
          if (this.daemonVersion !== DAEMON_VERSION) {
            this.close();
            if (typeof Bun === "undefined") {
              throw new DaemonClientError(
                "version_mismatch",
                `installed cueloop is ${this.daemonVersion ?? "unknown"}, but this adapter is ${DAEMON_VERSION}; run cueloop update`,
              );
            }

            throw new Error("daemon autostarted an older build");
          }

          return this;
        } catch (err) {
          if (err instanceof DaemonClientError) throw err;
          this.socket?.end();
          this.resetConnection();
          lastError = err;
          await sleep(50);
        }
      }
      const output = readFileSync(startupLogPath, "utf8").trim();
      const detail = output ? `\ndaemon startup output:\n${output.slice(-4_096)}` : "";

      throw new Error(`daemon did not come up at ${path}: ${String(lastError)}${detail}`);
    } finally {
      rmSync(startupLogPath, { force: true });
    }
  }

  private async dial(path: string): Promise<void> {
    const buffer = new LineBuffer();
    const epoch = ++this.connectionEpoch;

    const close = () => {
      if (this.connectionEpoch !== epoch) return;
      this.closed = true;
      for (const pendingRequest of this.pending.values())
        pendingRequest.reject(new Error("daemon connection closed"));
      this.pending.clear();
    };

    if (typeof Bun !== "undefined") {
      const socket = await Bun.connect({
        unix: path,
        socket: {
          data: (_socket, data) => {
            buffer.push(data.toString(), (line) => this.routeInboundFrame(line));
          },
          drain: () => this.writer?.drain(),
          close,
          error() {},
        },
      });

      this.socket = socket;
      this.writer = new BackpressureWriter(socket);
    } else {
      const socket = createConnection(path);

      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.on("data", (data) => {
        buffer.push(data.toString(), (line) => this.routeInboundFrame(line));
      });
      socket.on("close", close);
      socket.on("error", () => {});
      this.socket = socket;
      // Node queues the complete Buffer internally when write returns false.
      this.writer = new BackpressureWriter({
        write(data) {
          socket.write(data);

          return data.length;
        },
      });
    }
    // Verify liveness: a dead socket file accepts connects on some platforms
    // only to fail later, so a ping is the actual handshake. It also carries the
    // daemon's build version and pid, so connect() can replace a stale daemon.
    const pong = await this.request("daemon.ping", {}, PingResultSchema, 2_000);

    this.daemonVersion = pong.version;
    this.daemonPid = pong.pid;
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
  sessionCreate(workspace: WorkspaceKey, artifact: Artifact): Promise<Thread> {
    return this.request("session.create", { workspace, artifact }, ThreadRecordSchema);
  }
  sessionGet(id: string): Promise<Thread> {
    return this.request("session.get", { id }, ThreadRecordSchema);
  }
  sessionList(filter?: { status?: "pending" | "resolved" }): Promise<Thread[]> {
    return this.request("session.list", { filter }, v.array(ThreadRecordSchema));
  }
  /** Long-poll; null = still pending after timeoutMs (re-poll to collect). */
  sessionWait(id: string, timeoutMs: number): Promise<Thread | null> {
    return this.request(
      "session.wait",
      { id, timeoutMs },
      v.nullable(ThreadRecordSchema),
      timeoutMs + 10_000,
    );
  }
  sessionComment(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<Thread> {
    return this.request("session.comment", { id, annotation, authorName }, ThreadRecordSchema);
  }
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<Thread> {
    return this.request("session.annotate", { id, annotation, authorName }, ThreadRecordSchema);
  }
  sessionRemoveAnnotation(id: string, annotationId: string): Promise<Thread> {
    return this.request("session.removeAnnotation", { id, annotationId }, ThreadRecordSchema);
  }
  /** Register a display name for a participant - a collaborator's or an agent's own, on a share or locally. */
  sessionSetParticipantName(id: string, author: string, name: string): Promise<Thread> {
    return this.request("session.setParticipantName", { id, author, name }, ThreadRecordSchema);
  }
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): Promise<Thread> {
    return this.request("session.setWorkingCopy", { id, workingCopy }, ThreadRecordSchema);
  }
  sessionCutBlock(id: string, blockIndex: number): Promise<Thread> {
    return this.request("session.cutBlock", { id, blockIndex }, ThreadRecordSchema);
  }
  sessionNavigate(id: string, entryId: string, summary?: string, branch?: string): Promise<Thread> {
    const params: v.InferInput<(typeof Params)["session.navigate"]> = { id, entryId };

    if (summary !== undefined) params.summary = summary;
    if (branch !== undefined) params.branch = branch;

    return this.request("session.navigate", params, ThreadRecordSchema);
  }
  sessionBranch(id: string, name: string): Promise<Thread> {
    return this.request("session.branch", { id, name }, ThreadRecordSchema);
  }
  sessionSwitch(id: string, branch: string): Promise<Thread> {
    return this.request("session.switch", { id, branch }, ThreadRecordSchema);
  }
  sessionLabel(id: string, label: string): Promise<Thread> {
    return this.request("session.label", { id, label }, ThreadRecordSchema);
  }
  sessionFork(id: string): Promise<Thread> {
    return this.request("session.fork", { id }, ThreadRecordSchema);
  }
  sessionRestoreBlock(id: string, baseBlockIndex: number, line?: number): Promise<Thread> {
    return this.request(
      "session.restoreBlock",
      line === undefined ? { id, baseBlockIndex } : { id, baseBlockIndex, line },
      ThreadRecordSchema,
    );
  }
  sessionCurate(id: string, rejections: HunkRejection[]): Promise<Thread> {
    return this.request("session.curate", { id, rejections }, ThreadRecordSchema);
  }
  sessionSetAccess(id: string, githubLogins: string[]): Promise<Thread> {
    return this.request("session.setAccess", { id, githubLogins }, ThreadRecordSchema);
  }
  sessionSetViewed(id: string, viewedPaths: string[]): Promise<Thread> {
    return this.request("session.setViewed", { id, viewedPaths }, ThreadRecordSchema);
  }
  sessionSetTitle(id: string, title: string): Promise<Thread> {
    return this.request("session.setTitle", { id, title }, ThreadRecordSchema);
  }
  projectFiles(sessionId: string): Promise<string[]> {
    return this.request("session.projectFiles", { id: sessionId }, v.array(v.string()));
  }
  fileContents(sessionId: string, path: string): Promise<string | null> {
    return this.request("session.fileContents", { id: sessionId, path }, v.nullable(v.string()));
  }
  repoFiles(cwd: string): Promise<string[]> {
    return this.request("repo.files", { cwd }, v.array(v.string()));
  }
  repoFileContents(cwd: string, path: string): Promise<string | null> {
    return this.request("repo.fileContents", { cwd, path }, v.nullable(v.string()));
  }
  repoChanges(cwd: string): Promise<{ path: string; status: DiffFileStatus }[]> {
    return this.request(
      "repo.changes",
      { cwd },
      v.array(v.object({ path: v.string(), status: v.picklist(["added", "modified", "deleted"]) })),
    );
  }
  repoDiff(cwd: string): Promise<WorkingTreeDiff> {
    return this.request(
      "repo.diff",
      { cwd },
      v.object({ patch: v.string(), files: v.array(DiffFileContentsSchema) }),
    );
  }
  sessionWorkbench(cwd: string): Promise<Thread> {
    return this.request("session.workbench", { cwd }, ThreadRecordSchema);
  }
  /** Re-capture a diff session's working tree; changed=true when the patch moved and an event fired. */
  sessionRefreshDiff(id: string): Promise<{ changed: boolean }> {
    return this.request("session.refreshDiff", { id }, RefreshDiffResultSchema);
  }
  sessionSetShareId(id: string, shareId: string): Promise<Thread> {
    return this.request("session.setShareId", { id, shareId }, ThreadRecordSchema);
  }

  sessionSetShares(id: string, shares: ShareLink[]): Promise<Thread> {
    return this.request("session.setShares", { id, shares }, ThreadRecordSchema);
  }
  sessionMergeShared(id: string, incoming: SharedMerge): Promise<Thread> {
    return this.request("session.mergeShared", { id, ...incoming }, ThreadRecordSchema);
  }
  sessionDelete(id: string): Promise<void> {
    return this.request("session.delete", { id }, EmptyResultSchema).then(() => undefined);
  }
  /** Local sessions have no collaborator self-name; the share client owns this. */
  sessionSetSelfName(id: string, _name: string): Promise<Thread> {
    return this.sessionGet(id);
  }
  sessionSendMessage(
    id: string,
    outcome: MessageOutcome,
    summary: string,
    actionBodies?: Record<string, string>,
  ): Promise<Thread> {
    return this.request(
      "session.sendMessage",
      { id, outcome, summary, actionBodies },
      ThreadRecordSchema,
    );
  }
  harnessBind(
    threadId: string,
    harness: string,
    harnessSessionId: string,
  ): Promise<HarnessBinding> {
    return this.request(
      "harness.bind",
      { threadId, harness, harnessSessionId },
      HarnessBindingSchema,
    );
  }
  harnessGetBinding(bindingId: string): Promise<HarnessBinding> {
    return this.request("harness.getBinding", { bindingId }, HarnessBindingSchema);
  }
  harnessBindingsForSession(harness: string, harnessSessionId: string): Promise<HarnessBinding[]> {
    return this.request(
      "harness.bindingsForSession",
      { harness, harnessSessionId },
      v.array(HarnessBindingSchema),
    );
  }
  harnessConsumeApprovedRetry(
    bindingId: string,
    messageId: string,
    content: string,
  ): Promise<boolean> {
    return this.request(
      "harness.consumeApprovedRetry",
      { bindingId, messageId, content },
      v.boolean(),
    );
  }
  deliveryPending(bindingId: string): Promise<PendingDelivery[]> {
    return this.request("delivery.pending", { bindingId }, v.array(PendingDeliverySchema));
  }
  deliveryAcknowledge(deliveryId: string): Promise<Delivery> {
    return this.request("delivery.acknowledge", { deliveryId }, DeliverySchema);
  }
  sessionSubmitRevision(
    id: string,
    content: string,
    addressedAnnotationIds: string[] = [],
    files?: DiffFileContents[],
  ): Promise<Thread> {
    return this.request(
      "session.submitRevision",
      { id, content, addressedAnnotationIds, files },
      ThreadRecordSchema,
    );
  }
  /** Read Herdr's local Thread surface handle, outside the ThreadClient contract. */
  herdrGetThreadSurface(id: string): Promise<HerdrThreadSurfaceHandle | null> {
    return this.request("herdr.getThreadSurface", { id }, HerdrThreadSurfaceResultSchema);
  }
  async herdrSetThreadSurface(id: string, handle: HerdrThreadSurfaceHandle): Promise<void> {
    await this.request("herdr.setThreadSurface", { id, ...handle }, EmptyResultSchema);
  }
  ghosttyGetThreadSurface(id: string): Promise<GhosttyThreadSurfaceHandle | null> {
    return this.request("ghostty.getThreadSurface", { id }, GhosttyThreadSurfaceResultSchema);
  }
  async ghosttySetThreadSurface(id: string, handle: GhosttyThreadSurfaceHandle): Promise<void> {
    await this.request("ghostty.setThreadSurface", { id, ...handle }, EmptyResultSchema);
  }
  ghosttyClaimThreadSurface(id: string): Promise<boolean> {
    return this.request("ghostty.claimThreadSurface", { id }, v.boolean());
  }
  async ghosttyReleaseThreadSurface(id: string): Promise<void> {
    await this.request("ghostty.releaseThreadSurface", { id }, EmptyResultSchema);
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
// unlike the never-exiting foreground daemon); from source, bun runs main.ts. In
// dev (CUELOOP_DEV_WATCH=1, source only) it runs under --watch so daemon-code edits
// reload the daemon without a manual restart - the version handshake only catches
// release upgrades, not same-version source changes.
export function daemonSpawnCommand(
  execPath: string,
  moduleUrl: string,
  devWatch = process.env.CUELOOP_DEV_WATCH === "1",
): string[] {
  const compiled =
    moduleUrl.includes("$bunfs") || moduleUrl.includes("~BUN") || moduleUrl.includes("%7EBUN");

  if (compiled) return [execPath, "daemon", "--autostart"];
  const mainPath = new URL("./main.ts", moduleUrl).pathname;

  return devWatch ? [execPath, "--watch", "run", mainPath] : [execPath, "run", mainPath];
}

function spawnDaemon(home: string): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const startupLogPath = join(
    home,
    `daemon-startup-${process.pid}-${randomBytes(6).toString("hex")}.log`,
  );
  const logFd = openSync(startupLogPath, "wx", 0o600);

  try {
    if (typeof Bun === "undefined") {
      const child = spawn(process.env.CUELOOP_EXECUTABLE ?? "cueloop", ["daemon", "--autostart"], {
        env: { ...process.env, CUELOOP_HOME: home },
        stdio: ["ignore", logFd, logFd],
        detached: true,
      });

      child.on("error", (error) => appendFileSync(startupLogPath, `${String(error)}\n`));
      child.unref();
    } else {
      Bun.spawn(daemonSpawnCommand(process.execPath, import.meta.url), {
        env: { ...process.env, CUELOOP_HOME: home },
        stdio: ["ignore", logFd, logFd],
      }).unref();
    }
  } finally {
    closeSync(logFd);
  }

  return startupLogPath;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
