import {
  isMarkdownArtifact,
  newAnnotationId,
  type Annotation,
  type Artifact,
  type ArtifactType,
  type DiffFileContents,
  type DiffSource,
  type Thread,
  type WorkspaceKey,
  type WorkflowKind,
} from "@cueloop/schema";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { messageResponse } from "./api";
import { ABORTED, pollUntilResolved, raceAbort } from "./interruptible-wait";
import { VcsSourceManager } from "./vcs-source";

// Adapters and CLI primitives reach the message mapping through this module too,
// so a session obtained outside a ReviewHandle maps the same way.
export { messageResponse };

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("git", args, { cwd });

    return stdout.trim();
  } catch {
    return null;
  }
}

async function jjRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("jj", ["--ignore-working-copy", "root"], { cwd });

    return stdout.trim();
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
  const gitRepoRoot = await git(["rev-parse", "--show-toplevel"], cwd);
  const jjRepoRoot = await jjRoot(cwd);
  const nativeJjRoot =
    jjRepoRoot && (!gitRepoRoot || jjRepoRoot.length > gitRepoRoot.length) ? jjRepoRoot : null;
  const repoRoot = nativeJjRoot ?? gitRepoRoot ?? cwd;
  const branch = nativeJjRoot
    ? "jj"
    : ((await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) ?? "detached");
  // a shallow clone's oldest commit is the graft boundary, not the true root, so
  // it would key a different project than a full clone - leave it unset instead
  const shallow =
    nativeJjRoot !== null || (await git(["rev-parse", "--is-shallow-repository"], cwd)) === "true";
  const rootCommit = shallow
    ? undefined
    : earliestRootCommit(await git(["rev-list", "--max-parents=0", "--date-order", "HEAD"], cwd));
  const remote = nativeJjRoot ? null : await git(["remote", "get-url", "origin"], cwd);

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
  /** Workflow identity keeps plan/refine and diff/review Threads separate. */
  workflow?: WorkflowKind;
  content: string;
  /** Workspace resolution root and meta.cwd; defaults to process.cwd(). */
  cwd?: string;
  /** Optional explicit VCS selection for a diff that matches the checkout capture. */
  vcs?: string;
  /** The native logical change, set after a captured JJ diff is verified. */
  vcsChangeId?: string;
  /** Pre-resolved workspace key; skips git resolution when the caller already has it. */
  workspace?: WorkspaceKey;
  agent?: string;
  /** When set, a resubmit from the same agent session becomes a revision, not a new session. */
  agentSessionId?: string;
  planPath?: string;
  prototypePath?: string;
  pr?: string;
  prBrief?: string;
  prBaseSha?: string;
  prHeadSha?: string;
  prUrl?: string;
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

/** The transport-neutral daemon operations used by the shared review lifecycle. */
export interface ThreadSessionClient {
  sessionList(filter?: { status?: "pending" | "resolved" }): Promise<Thread[]>;
  sessionCreate(workspace: WorkspaceKey, artifact: Artifact): Promise<Thread>;
  sessionSubmitRevision(
    id: string,
    content: string,
    addressedAnnotationIds?: string[],
    files?: DiffFileContents[],
    source?: DiffSource,
  ): Promise<Thread>;
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): Promise<Thread>;
  sessionGet(id: string): Promise<Thread>;
  sessionWait(id: string, timeoutMs: number): Promise<Thread | null>;
}

/** Anchor a note at its file: quote = the path, no context selectors. */
async function attachNotes(
  client: ThreadSessionClient,
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

export interface AwaitMessageOptions {
  /** Total wait budget; Infinity keeps polling until resolved or aborted. */
  timeoutMs: number;
  /** Chunk length for the poll loop; between chunks the session is re-read for progress. */
  pollMs?: number;
  /** Called with the fresh session after each chunk that is still pending. */
  onProgress?: (session: Thread) => void;
  signal?: AbortSignal;
}

/** A resolved review mapped onto the agent contract, plus the full session. */
export interface MessageResult {
  allow: boolean;
  message: import("@cueloop/schema").Message;
  session: Thread;
}

export class ReviewHandle {
  constructor(
    private readonly client: Pick<ThreadSessionClient, "sessionWait" | "sessionGet">,
    readonly session: Thread,
  ) {}

  get id(): string {
    return this.session.id;
  }

  /**
   * Block on the message. "pending" means the budget ran out or the signal
   * aborted - the session stays open and the message is collectable later
   * (messages outlive waits). With only timeoutMs this is one long-poll;
   * pollMs/onProgress/signal switch to the chunked loop.
   */
  async awaitMessage(options: AwaitMessageOptions): Promise<MessageResult | "pending"> {
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

function outcome(session: Thread): MessageResult {
  return { ...messageResponse(session), session };
}

export interface AwaitResolveOptions {
  /** Long-poll chunk length; the wait re-arms each chunk until resolved or aborted. Default 30s. */
  pollMs?: number;
  /** Abort the wait (the harness session shut down); resolves to null. */
  signal?: AbortSignal;
}

/**
 * Park until a thread resolves, then return the message outcome; null
 * when the signal aborts first. Where ReviewHandle.awaitMessage needs the handle
 * that opened the review, this needs only a session id - so a background waiter
 * that woke on a session it did not open (a detached Claude Code / Codex waiter,
 * or pi's session_start listener) can collect the same message. This is the
 * wake seam every non-blocking adapter builds on. Loops the daemon long-poll, so
 * a message that lands between chunks is never missed and a session already
 * resolved returns on the first chunk. The held connection also keeps the daemon
 * off its idle-exit path for the whole wait.
 */
export async function awaitResolve(
  client: Pick<ThreadSessionClient, "sessionWait">,
  sessionId: string,
  options: AwaitResolveOptions = {},
): Promise<MessageResult | null> {
  const chunkMs = options.pollMs ?? 30_000;
  const resolved = await pollUntilResolved(
    () => client.sessionWait(sessionId, chunkMs),
    options.signal,
  );

  return resolved === null ? null : outcome(resolved);
}

/** Find the Thread already submitted by this agent in the same workspace and primitive. */
export async function findExistingReview(
  client: ThreadSessionClient,
  options: OpenReviewOptions,
): Promise<Thread | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const workspace = options.workspace ?? (await resolveWorkspace(cwd));

  if (options.agentSessionId === undefined) return undefined;

  const candidates = (await client.sessionList()).filter(
    (candidate) =>
      candidate.artifact.meta.agentSessionId === options.agentSessionId &&
      candidate.artifact.meta.agent === options.agent &&
      candidate.artifact.type === options.type &&
      (candidate.artifact.meta.workflow ??
        (candidate.artifact.meta.pr ? "review" : candidate.artifact.type)) ===
        (options.workflow ?? (options.pr ? "review" : options.type)) &&
      candidate.artifact.meta.pr === options.pr &&
      candidate.workspace.repoRoot === workspace.repoRoot &&
      candidate.workspace.branch === workspace.branch,
  );

  if (options.vcsChangeId !== undefined)
    return candidates.find(
      (candidate) => candidate.artifact.meta.vcsChangeId === options.vcsChangeId,
    );
  if (options.type === "diff" && options.vcs === "jj")
    return candidates
      .filter((candidate) => candidate.artifact.meta.vcs === "jj")
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  return candidates.find((candidate) => candidate.artifact.meta.vcsChangeId === undefined);
}

/** Attach VCS provenance only when the submitted patch matches a native capture. */
async function matchingDiffCapture(
  options: OpenReviewOptions,
  cwd: string,
): Promise<{ source?: DiffSource; files?: DiffFileContents[] }> {
  if (options.type !== "diff" || options.pr || !options.content.trim()) return {};
  try {
    const captured = await new VcsSourceManager().capture(cwd, options.vcs);

    if (captured.patch.replace(/\n+$/, "") !== options.content.replace(/\n+$/, "")) return {};

    return {
      source: {
        vcs: captured.vcs,
        changeId: captured.source?.changeId,
        revisionId: captured.source?.revisionId,
      },
      files: captured.files,
    };
  } catch {
    // A supplied patch stays reviewable even when the local source is unavailable.
    return {};
  }
}

/** Open a thread (or revise the agent session's existing one) and hand back the wait surface. */
export async function openReview(
  client: ThreadSessionClient,
  options: OpenReviewOptions,
): Promise<ReviewHandle> {
  const cwd = options.cwd ?? process.cwd();
  const workspace = options.workspace ?? (await resolveWorkspace(cwd));
  const { source, files: capturedFiles } = await matchingDiffCapture(options, cwd);
  const existing = await findExistingReview(client, {
    ...options,
    vcsChangeId: source?.changeId,
  });

  if (existing !== undefined) {
    // PR diffs have no full file contents. An absent local-diff capture clears
    // old curatable files, while a PR revision must keep curation disabled.
    const revisionFiles =
      options.type !== "diff" || options.pr ? undefined : (options.files ?? capturedFiles ?? []);
    let revised = await client.sessionSubmitRevision(
      existing.id,
      options.content,
      [],
      revisionFiles,
      source,
    );

    if (options.notes?.length) {
      await attachNotes(client, revised.id, options.notes);
      revised = await client.sessionGet(revised.id);
    }

    return new ReviewHandle(client, revised);
  }
  let session = await client.sessionCreate(workspace, {
    type: options.type,
    content: options.content,
    files: options.files ?? capturedFiles,
    meta: {
      workflow: options.workflow,
      agent: options.agent,
      agentSessionId: options.agentSessionId,
      planPath: options.planPath,
      prototypePath: options.prototypePath,
      pr: options.pr,
      prBrief: options.prBrief,
      prBaseSha: options.prBaseSha,
      prHeadSha: options.prHeadSha,
      prUrl: options.prUrl,
      herdrPane: options.herdrPane,
      title:
        options.title ??
        (isMarkdownArtifact(options.type) ? firstHeading(options.content) : undefined),
      cwd,
      vcs: source?.vcs,
      vcsChangeId: source?.changeId,
      vcsRevisionId: source?.revisionId,
    },
  });

  if (options.notes?.length) {
    await attachNotes(client, session.id, options.notes);
    session = await client.sessionGet(session.id);
  }

  return new ReviewHandle(client, session);
}
