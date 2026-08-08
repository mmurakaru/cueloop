/**
 * The ReviewSession primitive (map #2, #9). Everything in cueloop renders,
 * annotates, or resolves this one noun. This module is pure data shapes -
 * no IO, no dependencies.
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

/** The annotation kind set is open (map #2); these are the built-ins. */
export type AnnotationKind = "comment" | "suggestion" | (string & {});

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  anchor: Anchor;
  /** Comment body, or the replacement text for suggestions. */
  body: string;
  /** Set by resolution when the quote can no longer be found. */
  orphan?: boolean;
  createdAt: string;
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
