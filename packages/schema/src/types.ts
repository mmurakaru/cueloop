/**
 * The ReviewSession primitive. Everything in cueloop renders, annotates, or
 * resolves this one noun. This module is pure data shapes - no IO, no
 * dependencies.
 */

export const SCHEMA_VERSION = "1";

/** A workspace is a repo/branch context holding review sessions. */
export interface WorkspaceKey {
  repoRoot: string;
  branch: string;
}

export type ArtifactType = "plan" | "diff";

export interface ArtifactMeta {
  cwd?: string;
  agent?: string;
  /** Agent-native session id, for resume/fork context. */
  agentSessionId?: string;
  /** Path to the plan file on disk, so feedback can reference it. */
  planPath?: string;
  /** Pull request reference the diff came from, so the verdict can be posted back. */
  pr?: string;
  /** herdr pane the submitting agent runs in - the review returns focus there. */
  herdrPane?: string;
  title?: string;
}

export interface Artifact {
  type: ArtifactType;
  /** Markdown source for plans; unified-diff text for diffs. */
  content: string;
  meta: ArtifactMeta;
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
  /** Index of the block the anchor was made in (hint). */
  blockIndex?: number;
  /** Character offsets within that block's text (hint). */
  start?: number;
  end?: number;
}

/** The annotation kind set is open; these are the built-ins. */
export type AnnotationKind = "comment" | "suggestion" | (string & {});

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
  /** Comment body, or the replacement text for suggestions. */
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

export interface ReviewSession {
  schemaVersion: string;
  id: string;
  workspace: WorkspaceKey;
  artifact: Artifact;
  /** Revision history; artifact.content always equals the latest revision. */
  revisions: Revision[];
  annotations: Annotation[];
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
