/**
 * The Thread primitive. Everything in cueloop renders, annotates, or
 * extends this one noun. This module is pure data shapes - no IO, no
 * dependencies beyond the history shapes.
 */

import type { SessionHistory } from "./history";

export const SCHEMA_VERSION = "1";

/** A workspace is a repo/branch context holding threads. */
export interface WorkspaceKey {
  repoRoot: string;
  branch: string;
  rootCommit?: string;
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

/** Harness workflows; review and refine are compositions, never artifact types. */
export const WORKFLOW_KINDS = ["plan", "reply", "prototype", "diff", "review", "refine"] as const;

export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

/** Agent skills installed by each harness, including workflows that don't submit an artifact. */
export const WORKFLOW_SKILL_KINDS = [...WORKFLOW_KINDS, "pair"] as const;

export type WorkflowSkillKind = (typeof WORKFLOW_SKILL_KINDS)[number];

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
  workflow?: WorkflowKind;
  cwd?: string;
  vcs?: string;
  vcsChangeId?: string;
  vcsRevisionId?: string;
  agent?: string;
  agentSessionId?: string;
  planPath?: string;
  prototypePath?: string;
  pr?: string;
  prBrief?: string;
  prBaseSha?: string;
  prHeadSha?: string;
  prRefreshBaseSha?: string;
  prRefreshHeadSha?: string;
  prUrl?: string;
  herdrPane?: string;
  title?: string;
  workbench?: boolean;
  snapshot?: boolean;
}

/** VCS provenance for a submitted diff revision. */
export interface DiffSource {
  vcs: string;
  changeId?: string;
  revisionId?: string;
  baseRevisionId?: string;
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
  status: DiffFileStatus;
}

export interface Artifact {
  type: ArtifactType;
  content: string;
  meta: ArtifactMeta;
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
  blockIndex?: number;
  endBlockIndex?: number;
  start?: number;
  end?: number;
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
  target?: AnnotationTarget;
  body: string;
  orphan?: boolean;
  author?: string;
  reviewComment?: ReviewComment;
  replyTo?: string;
  resolution?: AnnotationResolution;
  createdAt: string;
}

export const REVIEW_SEVERITIES = ["p0", "p1", "p2"] as const;

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/** Data needed to render and publish one agent-authored pull request comment. */
export interface ReviewComment {
  severity: ReviewSeverity;
  title: string;
  path: string;
  line: number;
  startLine?: number;
  startAnchor?: Anchor;
  side: "LEFT" | "RIGHT";
  suggestion?: string;
  prompt?: string;
}

export interface AnnotationResolution {
  revision: number;
  source: "agent" | "drift";
}

/** An annotation a revision has addressed; it leaves the default views. */
export function isAddressed(annotation: Annotation): boolean {
  return annotation.resolution !== undefined;
}

/** A harness session bound to a Thread. Harness identity stays outside the Thread itself. */
export interface HarnessBinding {
  id: string;
  threadId: string;
  harness: string;
  harnessSessionId: string;
  createdAt: string;
  approvedRetryMessageId?: string;
}

/** Durable routing state for one Message sent to one harness binding. */
export interface Delivery {
  id: string;
  messageId: string;
  bindingId: string;
  status: "pending" | "acknowledged";
  createdAt: string;
  acknowledgedAt?: string;
}

/** What a harness adapter pulls: routing state plus its immutable Message payload. */
export interface PendingDelivery {
  delivery: Delivery;
  message: Message;
}

export const MESSAGE_OUTCOMES = ["comment", "approved", "changes_requested"] as const;

export type MessageOutcome = (typeof MESSAGE_OUTCOMES)[number];

/** Durable acceptance records are committed together with the mutation they identify. */
export interface OperationReceipt<Result> {
  operationId: string;
  fingerprint: string;
  result: Result;
}

export interface Message {
  id: string;
  outcome: MessageOutcome;
  summary: string;
  body: string;
  annotations?: Annotation[];
  sentAt: string;
}

export interface Revision {
  revision: number;
  content: string;
  submittedAt: string;
  source?: DiffSource;
  files?: DiffFileContents[];
}

export type SessionStatus = "pending" | "resolved";

/**
 * A person who authored annotations on a session. `id` is the stable key an
 * annotation's `author` points at - the SSH fingerprint today, an OAuth id
 * ("github:…") later. Provider-agnostic so those identities slot in unchanged.
 */
export interface Identity {
  id: string;
  provider: "ssh" | "github";
  name?: string;
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
  id: string;
  name?: string;
  requireAuth: boolean;
  allowlist: string[];
  owner?: string;
  shareBranch?: string;
}

/** One exact character range removed from the submitted artifact source. */
export interface TextCut {
  start: number;
  end: number;
  quote: string;
}

/** Local links use shares; scalar share fields remain for CLI sharing, gateway authorization, and stored-record migration. */
export interface Thread {
  schemaVersion: string;
  id: string;
  workspace: WorkspaceKey;
  artifact: Artifact;
  revisions: Revision[];
  annotations: Annotation[];
  history?: SessionHistory;
  curation?: HunkRejection[];
  workingCopy?: string;
  textCuts?: TextCut[];
  viewedPaths?: string[];
  messageOperations?: OperationReceipt<Message>[];
  message: Message | null;
  status: SessionStatus;
  createdAt: string;
  shelvedAnnotations?: Annotation[];
  parentSessionId?: string;
  shares?: ShareLink[];
  shareId?: string;
  shareBranch?: string;
  owner?: string;
  access?: ShareAccess;
  participants?: Identity[];
}

/** Whether a Message releases a harness gate. */
export function messageAllows(outcome: MessageOutcome): boolean {
  return outcome === "approved";
}

let messageSeq = 0;

/** A process-unique, time-sortable Message id for delivery deduplication. */
export function newMessageId(): string {
  return `msg_${Date.now().toString(36)}${(messageSeq++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
