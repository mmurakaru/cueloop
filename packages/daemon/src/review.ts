/**
 * The shared review core: one open/wait/verdict path for every consumer -
 * CLI commands and agent adapters. openReview resolves the workspace, shapes
 * the artifact, and opens-or-revises by agentSessionId; awaitVerdict maps the
 * wait contract onto the agent contract through verdictResponse. An
 * adapter keeps only two bespoke parts: parsing its host's event shape and
 * serializing the decision in its host's contract.
 */

import {
  isMarkdownArtifact,
  newAnnotationId,
  type ArtifactType,
  type DiffFileContents,
  type ReviewSession,
  type WorkspaceKey,
} from "@cueloop/schema";
import { verdictResponse } from "./api";
import type { DaemonClient } from "./client";

// Adapters and CLI primitives reach the verdict mapping through this module too,
// so a session obtained outside a ReviewHandle maps the same way.
export { verdictResponse };

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();

    if ((await proc.exited) !== 0) return null;

    return out.trim();
  } catch {
    return null;
  }
}

/** The oldest root commit reachable from HEAD; the project key that survives moving or re-cloning the repo. */
function earliestRootCommit(revList: string | null): string | undefined {
  if (!revList) return undefined;
  const roots = revList.split("\n").filter((line) => line.length > 0);

  // --date-order lists newest first, so the last root is the earliest
  return roots.at(-1);
}

/** Workspace key resolution: repo root, branch, and the project identity (root commit + remote) from the cwd. */
export async function resolveWorkspace(cwd = process.cwd()): Promise<WorkspaceKey> {
  const repoRoot = (await git(["rev-parse", "--show-toplevel"], cwd)) ?? cwd;
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) ?? "detached";
  // a shallow clone's oldest commit is the graft boundary, not the true root, so
  // it would key a different project than a full clone - leave it unset instead
  const shallow = (await git(["rev-parse", "--is-shallow-repository"], cwd)) === "true";
  const rootCommit = shallow
    ? undefined
    : earliestRootCommit(await git(["rev-list", "--max-parents=0", "--date-order", "HEAD"], cwd));
  const remote = await git(["remote", "get-url", "origin"], cwd);

  const workspace: WorkspaceKey = { repoRoot, branch };
  // a repo with no commits (or a shallow clone) has no reliable root, so the thread stays standalone
  if (rootCommit) workspace.rootCommit = rootCommit;
  if (remote) workspace.remote = remote;

  return workspace;
}

function firstHeading(markdown: string): string | undefined {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);

  return headingMatch?.[1]?.trim();
}

export interface OpenReviewOptions {
  type: ArtifactType;
  content: string;
  /** Workspace resolution root and meta.cwd; defaults to process.cwd(). */
  cwd?: string;
  /** Pre-resolved workspace key; skips git resolution when the caller already has it. */
  workspace?: WorkspaceKey;
  agent?: string;
  /** When set, a resubmit from the same agent session becomes a revision, not a new session. */
  agentSessionId?: string;
  planPath?: string;
  prototypePath?: string;
  pr?: string;
  herdrPane?: string;
  /**
   * Full file contents per changed file for a working-tree diff, carried onto
   * the artifact so hunk curation produces an exactly applyable patch.
   */
  files?: DiffFileContents[];
  /** Defaults to a markdown artifact's first heading (plan, reply); diffs get no derived title. */
  title?: string;
  /**
   * Per-file agent notes for diff sessions: the submitting agent's own
   * explanation of each file's change, in dead prose. Stored as annotations
   * with kind "note" anchored at the file path, so they render as regular
   * rail cards and feed the guided walk's agent-note block.
   */
  notes?: ReviewNote[];
}

/** The note contract: one note per changed file, anchored by the file path. */
export interface ReviewNote {
  path: string;
  body: string;
}

/** Anchor a note at its file: quote = the path, no context selectors. */
async function attachNotes(
  client: DaemonClient,
  sessionId: string,
  notes: ReviewNote[],
): Promise<void> {
  for (const note of notes) {
    await client.sessionAnnotate(sessionId, {
      id: newAnnotationId(),
      kind: "note",
      anchor: { quote: note.path, prefix: "", suffix: "" },
      body: note.body,
    });
  }
}

export interface AwaitVerdictOptions {
  /** Total wait budget; Infinity keeps polling until resolved or aborted. */
  timeoutMs: number;
  /** Chunk length for the poll loop; between chunks the session is re-read for progress. */
  pollMs?: number;
  /** Called with the fresh session after each chunk that is still pending. */
  onProgress?: (session: ReviewSession) => void;
  signal?: AbortSignal;
}

/** A resolved review mapped onto the agent contract, plus the full session. */
export interface VerdictOutcome {
  allow: boolean;
  feedback: string;
  session: ReviewSession;
}

/** Sentinel distinguishing an abort from any daemon response. */
const ABORTED = Symbol("aborted");

function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof ABORTED> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});

    return Promise.resolve(ABORTED);
  }

  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = () => {
      // The daemon request keeps running until the client closes; swallow its
      // eventual rejection so the abort path never leaks an unhandled error.
      promise.catch(() => {});
      resolve(ABORTED);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class ReviewHandle {
  constructor(
    private readonly client: DaemonClient,
    readonly session: ReviewSession,
  ) {}

  get id(): string {
    return this.session.id;
  }

  /**
   * Block on the verdict. "pending" means the budget ran out or the signal
   * aborted - the session stays open and the verdict is collectable later
   * (verdicts outlive waits). With only timeoutMs this is one long-poll;
   * pollMs/onProgress/signal switch to the chunked loop.
   */
  async awaitVerdict(options: AwaitVerdictOptions): Promise<VerdictOutcome | "pending"> {
    const { timeoutMs, pollMs, onProgress, signal } = options;

    if (pollMs === undefined && onProgress === undefined && signal === undefined) {
      const resolved = await this.client.sessionWait(this.session.id, timeoutMs);

      return resolved === null ? "pending" : outcome(resolved);
    }
    const chunkMs = pollMs ?? 10_000;
    const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : undefined;

    for (;;) {
      const budget = deadline === undefined ? chunkMs : Math.min(chunkMs, deadline - Date.now());

      if (budget <= 0 || signal?.aborted) return "pending";
      const resolved = await raceAbort(this.client.sessionWait(this.session.id, budget), signal);

      if (resolved === ABORTED) return "pending";
      if (resolved !== null) return outcome(resolved);
      // Still pending after this chunk: re-read to surface reviewer progress.
      const current = await raceAbort(this.client.sessionGet(this.session.id), signal);

      if (current === ABORTED) return "pending";
      onProgress?.(current);
    }
  }
}

function outcome(session: ReviewSession): VerdictOutcome {
  return { ...verdictResponse(session), session };
}

export interface AwaitResolveOptions {
  /** Long-poll chunk length; the wait re-arms each chunk until resolved or aborted. Default 30s. */
  pollMs?: number;
  /** Abort the wait (the harness session shut down); resolves to null. */
  signal?: AbortSignal;
}

/**
 * Park until a review session resolves, then return the verdict outcome; null
 * when the signal aborts first. Where ReviewHandle.awaitVerdict needs the handle
 * that opened the review, this needs only a session id - so a background waiter
 * that woke on a session it did not open (a detached Claude Code / Codex waiter,
 * or pi's session_start listener) can collect the same verdict. This is the
 * wake seam every non-blocking adapter builds on. Loops the daemon long-poll, so
 * a verdict that lands between chunks is never missed and a session already
 * resolved returns on the first chunk. The held connection also keeps the daemon
 * off its idle-exit path for the whole wait.
 */
export async function awaitResolve(
  client: DaemonClient,
  sessionId: string,
  options: AwaitResolveOptions = {},
): Promise<VerdictOutcome | null> {
  const chunkMs = options.pollMs ?? 30_000;
  const { signal } = options;

  for (;;) {
    if (signal?.aborted) return null;
    const resolved = await raceAbort(client.sessionWait(sessionId, chunkMs), signal);

    if (resolved === ABORTED) return null;
    if (resolved !== null) return outcome(resolved);
  }
}

/** Open a review session (or revise the agent session's existing one) and hand back the wait surface. */
export async function openReview(
  client: DaemonClient,
  options: OpenReviewOptions,
): Promise<ReviewHandle> {
  const cwd = options.cwd ?? process.cwd();
  const workspace = options.workspace ?? (await resolveWorkspace(cwd));

  // Resubmits from the same agent session become revisions, not new sessions -
  // but only within the same primitive: a different artifact type is a new
  // review, never a silent type mismatch on the old session.
  if (options.agentSessionId !== undefined) {
    const existing = (await client.sessionList()).find(
      (candidate) =>
        candidate.artifact.meta.agentSessionId === options.agentSessionId &&
        candidate.artifact.type === options.type,
    );

    if (existing !== undefined) {
      let revised = await client.sessionSubmitRevision(existing.id, options.content);

      if (options.notes?.length) {
        await attachNotes(client, revised.id, options.notes);
        revised = await client.sessionGet(revised.id);
      }

      return new ReviewHandle(client, revised);
    }
  }
  let session = await client.sessionCreate(workspace, {
    type: options.type,
    content: options.content,
    files: options.files,
    meta: {
      agent: options.agent,
      agentSessionId: options.agentSessionId,
      planPath: options.planPath,
      prototypePath: options.prototypePath,
      pr: options.pr,
      herdrPane: options.herdrPane,
      title:
        options.title ??
        (isMarkdownArtifact(options.type) ? firstHeading(options.content) : undefined),
      cwd,
    },
  });

  if (options.notes?.length) {
    await attachNotes(client, session.id, options.notes);
    session = await client.sessionGet(session.id);
  }

  return new ReviewHandle(client, session);
}
