/**
 * The ReviewSession primitive. Everything in cueloop renders, annotates, or
 * resolves this one noun. This module is pure data shapes - no IO, no
 * dependencies beyond the history shapes.
 */

import type { SessionHistory } from "./history";

export const SCHEMA_VERSION = "1";

/** A workspace is a repo/branch context holding review sessions. */
export interface WorkspaceKey {
  repoRoot: string;
  branch: string;
}

/**
 * What kind of artifact a review session holds. `plan` and `reply` are both
 * markdown documents (see isMarkdownArtifact) - a plan is a proposal written
 * forward, a reply is the agent's previous message pulled back for review.
 * `diff` is a unified-diff patch; `prototype` is a rendered HTML page.
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
 * Markdown artifacts (plan, reply) are block-parsed and quote-anchored, so they
 * share the plan render path, first-heading title derivation, and revision
 * drift-assist. A diff (a patch) and a prototype (HTML/DOM) do not - keep this
 * the one place that names the set, so a new markdown primitive joins here once.
 */
export function isMarkdownArtifact(type: ArtifactType): boolean {
  return type === "plan" || type === "reply";
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
  /** Identity source. One value today; widen the union when OAuth lands. */
  provider: "ssh";
  /** Display name; absent = the collaborator stayed anonymous. */
  name?: string;
  /** Provider handle: a github login, an email, or a short fingerprint. */
  handle?: string;
}

export interface ReviewSession {
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
  /** Share id once published; lets the planner pull collaborator notes back. */
  shareId?: string;
  /** SSH fingerprint that created the share; the gateway stamps it to gate pulls. */
  owner?: string;
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
