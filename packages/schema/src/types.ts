/**
 * The Thread primitive. Everything in cueloop renders, annotates, or
 * resolves this one noun. This module is pure data shapes - no IO, no
 * dependencies beyond the history shapes.
 */

import type { SessionHistory } from "./history";

export const SCHEMA_VERSION = "1";

/** A workspace is a repo/branch context holding threads. */
export interface WorkspaceKey {
  repoRoot: string;
  branch: string;
  /** Earliest root commit SHA; the project key that survives moving or re-cloning the repo. Absent for a standalone thread. */
  rootCommit?: string;
  /** Origin remote URL when present; for display and repair only, never the project key. */
  remote?: string;
}

/**
 * What kind of artifact a thread holds. `plan` and `reply` are both
 * markdown documents (see isMarkdownArtifact) - a plan is a proposal written
 * forward, a reply is the agent's previous message pulled back for review.
 * `diff` is a unified-diff patch; `prototype` is a component design doc (API /
 * Composition / Callstack) in markdown, with an opt-in experimental pixel mode.
 *
 * One runtime union: every consumer that names the supported set - daemon
 * wire validation, CLI flag parsing, adapter tool schemas - derives from this
 * constant, so a new primitive extends them all without another hardcoded list.
 */
export const ARTIFACT_TYPES = ["plan", "diff", "prototype", "reply"] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Trust-boundary guard: is this string one of the artifact primitives? */
export function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPES.some((candidate) => candidate === value);
}

/**
 * Markdown artifacts (plan, reply, prototype) are block-parsed and quote-anchored,
 * so they share the plan render path, first-heading title derivation, and revision
 * drift-assist. A prototype is a component design doc (API / Composition / Callstack)
 * by default; its opt-in experimental pixel mode is a client render override, not a
 * different artifact. A diff (a patch) does not - keep this the one place that names
 * the set, so a new markdown primitive joins here once.
 */
export function isMarkdownArtifact(type: ArtifactType): boolean {
  return type === "plan" || type === "reply" || type === "prototype";
}

export interface ArtifactMeta {
  cwd?: string;
  agent?: string;
  /** Agent-native session id, for resume/fork context. */
  agentSessionId?: string;
  /** Path to the plan or reply markdown file on disk, so feedback can reference it. */
  planPath?: string;
  /** Path to the prototype's entry HTML file on disk. */
  prototypePath?: string;
  /** Pull request reference the diff came from, so the verdict can be posted back. */
  pr?: string;
  /** herdr pane the submitting agent runs in - the review returns focus there. */
  herdrPane?: string;
  title?: string;
  /** A self-initiated per-repo workbench thread (a bare launch's first comment), not an agent submission. */
  workbench?: boolean;
  /** A frozen point-in-time capture of a workbench thread's diff, for a remote reviewer who has no working tree. */
  snapshot?: boolean;
}

/** Full old/new contents of one changed file, keyed by its repo-relative path. */
/** How a file changed, so curation emits the right create/delete headers. */
export type DiffFileStatus = "added" | "modified" | "deleted";

/**
 * One reject decision of a diff review: a whole hunk, or one change block of
 * it when `changeIndex` is set. The daemon curates the working copy from the
 * full set, so every client sees the same patch.
 */
export interface HunkRejection {
  path: string;
  hunkIndex: number;
  changeIndex?: number;
}

export interface DiffFileContents {
  path: string;
  oldContents: string;
  newContents: string;
  /** git's own classification - not inferred from empty contents, so an
   *  existing-empty-file edit is a modify, not a create/delete. */
  status: DiffFileStatus;
}

export interface Artifact {
  type: ArtifactType;
  /** Markdown source for plans and replies; unified-diff text for diffs. */
  content: string;
  meta: ArtifactMeta;
  /**
   * Full file contents for a diff artifact, so hunk curation produces an
   * exactly applyable patch; absent for legacy or partial (PR) diffs.
   */
  files?: DiffFileContents[];
}

/**
 * Anchors are quote-primary selectors (Hypothesis-style), resolved against
 * the artifact's current text by the cascade in anchor.ts. Position fields
 * are hints, never authority.
 */
export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
  /** Index of the block the anchor starts in (hint). */
  blockIndex?: number;
  /** Last block of a quote that spans blocks (hint); absent for one block. */
  endBlockIndex?: number;
  /** Character offsets: `start` within the first block, `end` within the last (hint). */
  start?: number;
  end?: number;
  /** Prototype anchors: the CSS selector of the annotated element (authority). */
  selector?: string;
}

/** The annotation kind set is open; these are the built-ins. */
export type AnnotationKind = "comment" | (string & {});

/**
 * The surface an annotation was made on. Name-only: the ref names the surface and the
 * client loads that surface's text to resolve the quote anchor. Absent means the session's
 * reviewed artifact, so every existing annotation keeps its meaning with no data change.
 * A `file` target's `rev` doubles as the diff side: worktree for an added or context row,
 * head for a deletion.
 */
export type AnnotationTarget =
  | { kind: "artifact" }
  | { kind: "file"; path: string; rev: "worktree" | "head" }
  | { kind: "welcome" };

/** The target an annotation resolves against; absent records mean the reviewed artifact. */
export function annotationTarget(annotation: Pick<Annotation, "target">): AnnotationTarget {
  return annotation.target ?? { kind: "artifact" };
}

/**
 * Agent-authored context, not reviewer feedback: the guided walk's per-file
 * notes (kind "note", anchored by the file path). Excluded from the feedback
 * document and the reviewer's pending counts - an agent must never receive
 * its own notes back as items to address.
 */
export function isAgentNote(annotation: Pick<Annotation, "kind">): boolean {
  return annotation.kind === "note";
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  anchor: Anchor;
  /** The surface this note was made on; absent means the session's reviewed artifact. */
  target?: AnnotationTarget;
  /** Comment body. */
  body: string;
  /** Set by resolution when the quote can no longer be found. */
  orphan?: boolean;
  /**
   * SSH key fingerprint of a share collaborator who authored this note. Absent
   * on the planner's own annotations; the sharing gateway stamps it so the
   * planner can tell whose note is whose and never overwrite a collaborator's.
   */
  author?: string;
  /**
   * The root comment this one replies to. Absent on a root. A reply shares its
   * root's anchor, so a discussion stays one conversation when the text moves.
   */
  replyTo?: string;
  /**
   * Set when a revision addressed this annotation: the agent reported the id
   * on resubmit ("agent"), or the quoted text disappeared from the revised
   * plan ("drift"). Addressed annotations leave the default rail view and the
   * next feedback document, but are never deleted.
   */
  resolution?: AnnotationResolution;
  createdAt: string;
}

export interface AnnotationResolution {
  /** The revision number whose submission addressed this annotation. */
  revision: number;
  source: "agent" | "drift";
}

/** An annotation a revision has addressed; it leaves the default views. */
export function isAddressed(annotation: Annotation): boolean {
  return annotation.resolution !== undefined;
}

export type VerdictKind = "comment" | "approve" | "request_changes";

export interface Verdict {
  kind: VerdictKind;
  summary: string;
  /** The one structured feedback document sent to the agent. */
  feedback: string;
  resolvedAt: string;
}

export interface Revision {
  revision: number;
  content: string;
  submittedAt: string;
}

export type SessionStatus = "pending" | "resolved";

/**
 * A person who authored annotations on a session. `id` is the stable key an
 * annotation's `author` points at - the SSH fingerprint today, an OAuth id
 * ("github:…") later. Provider-agnostic so those identities slot in unchanged.
 */
export interface Identity {
  /** Stable identity key; equals an annotation's `author`. */
  id: string;
  /** Identity source: the SSH key that authored, or a verified GitHub login. */
  provider: "ssh" | "github";
  /** Display name; absent = the collaborator stayed anonymous. */
  name?: string;
  /** Provider handle: a github login, an email, or a short fingerprint. */
  handle?: string;
}

/** Owner-set access control for a private share: only these GitHub logins may open it. Absent = a public share. */
export interface ShareAccess {
  githubLogins: string[];
}

/**
 * One published share link for a thread. A thread can have several, each an
 * independent gateway blob keyed by its own `id`. `name` is a local-only label
 * to tell links apart; `requireAuth` gates the link behind the `allowlist` of
 * GitHub logins (empty + requireAuth is a private link with no one added yet).
 */
export interface ShareLink {
  /** The share id (`p_…`), the link's address and gateway blob key. */
  id: string;
  /** A local, cosmetic label for the list; never leaves the planner's machine. */
  name?: string;
  /** True = private (only `allowlist` may open it); false = public. */
  requireAuth: boolean;
  /** GitHub logins allowed when `requireAuth`; ignored when public. */
  allowlist: string[];
  /** SSH fingerprint that created the link; the gateway stamps it to gate pulls/pushes/revokes. */
  owner?: string;
  /** The branch this link follows and shows collaborators; `main` when absent. */
  shareBranch?: string;
}

export interface Thread {
  schemaVersion: string;
  id: string;
  workspace: WorkspaceKey;
  artifact: Artifact;
  /** Revision history; artifact.content always equals the latest revision. */
  revisions: Revision[];
  annotations: Annotation[];
  /**
   * The session's history as a tree of entries with named branches; the
   * artifact text and the open comments derive from the active path. Absent
   * only on records written before histories existed; the store migrates
   * those on read.
   */
  history?: SessionHistory;
  /** A diff review's reject decisions; the working copy is the patch they leave. */
  curation?: HunkRejection[];
  /**
   * The reviewer's working copy of the artifact source (plan edits).
   * Serializes as ONE unified diff against the submitted revision.
   * Undefined = no direct edits.
   */
  workingCopy?: string;
  /**
   * File paths the reviewer marked viewed during the guided walk (diff
   * sessions). Persisting with the session means a resumed review keeps its
   * progress. Undefined = the walk never started.
   */
  viewedPaths?: string[];
  verdict: Verdict | null;
  status: SessionStatus;
  createdAt: string;
  /**
   * Comments off the active path - removed, or made on a segment a tip moved
   * away from. Nothing is deleted: a navigate or switch that brings their
   * entries back onto the path shows them again.
   */
  shelvedAnnotations?: Annotation[];
  /** The session this one was forked from. */
  parentSessionId?: string;
  /** Published share links for this thread; each is an independent gateway blob. Migrated from the legacy scalar fields on read. */
  shares?: ShareLink[];
  /** @deprecated Legacy single-share id; migrated into `shares` on read. */
  shareId?: string;
  /** @deprecated Legacy single-share branch; migrated into `shares` on read. */
  shareBranch?: string;
  /** @deprecated Legacy single-share owner fingerprint; migrated into `shares` on read. */
  owner?: string;
  /** @deprecated Legacy single-share allowlist; migrated into `shares` on read. */
  access?: ShareAccess;
  /**
   * Identities that authored annotations here, keyed by id (union-by-id, like
   * annotations). The gateway records a collaborator's identity and chosen name;
   * the rail resolves an annotation's `author` against this registry.
   */
  participants?: Identity[];
}

/** comment and request_changes both map to deny in agent-native contracts. */
export function verdictAllows(kind: VerdictKind): boolean {
  return kind === "approve";
}

/**
 * Annotation ids are minted client-side. The counter makes ids unique within
 * a process by construction; the random suffix separates concurrent
 * annotators in different processes on the same millisecond.
 */
let annotationSeq = 0;

export function newAnnotationId(): string {
  return `a_${Date.now().toString(36)}${(annotationSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
