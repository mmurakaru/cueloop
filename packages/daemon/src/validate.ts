/**
 * Runtime validation of the wire boundary. Everything arriving over the
 * socket is untrusted JSON: adapters, the CLI, extensions, and any script a
 * user writes all speak this protocol. Validating here means DaemonCore only
 * ever sees well-formed input, and a malformed request gets a precise error
 * instead of a downstream crash.
 *
 * valibot is cueloop's validation library - modular, tiny, and tree-shakeable,
 * which matters for a CLI whose startup latency the user feels on every review.
 */

import * as v from "valibot";
import {
  ARTIFACT_TYPES,
  MESSAGE_OUTCOMES,
  WORKFLOW_KINDS,
  SCHEMA_VERSION,
  type Anchor,
  type Annotation,
  type AnnotationTarget,
  type Artifact,
  type ArtifactMeta,
  type DiffFileContents,
  type Identity,
  type Thread,
  type TextCut,
  type HunkRejection,
  type HarnessBinding,
  type Delivery,
  type PendingDelivery,
  type Revision,
  type SessionHistory,
  type ShareAccess,
  type ShareLink,
  validateHistory,
  type Message,
  type WorkspaceKey,
  applyTextCuts,
} from "@cueloop/schema";
import { DaemonError } from "./errors";
import type { Request } from "./protocol";

/**
 * Drift guard for every hand-mirrored shape below. v.object strips keys it
 * does not know, so a schema missing a field silently drops that field on
 * the way into DaemonCore. Each entries object is checked with
 * `satisfies EntriesOf<T>`: adding a field to the schema types without
 * mirroring it here (or mirroring a key that does not exist) fails typecheck.
 */
type EntriesOf<T> = { [K in keyof T]-?: v.GenericSchema<any, any> };

const NonEmpty = v.pipe(v.string(), v.minLength(1));

const TextCutSchema = v.object({
  start: v.pipe(v.number(), v.integer(), v.minValue(0)),
  end: v.pipe(v.number(), v.integer(), v.minValue(1)),
  quote: NonEmpty,
} satisfies EntriesOf<TextCut>);

const TextCutsSchema = v.pipe(
  v.array(TextCutSchema),
  v.check(
    (cuts) =>
      cuts.every(
        (cut, index) =>
          cut.end - cut.start === cut.quote.length &&
          (index === 0 || cuts[index - 1]!.end <= cut.start),
      ),
    "text Cuts must be ordered, non-overlapping, and match their quote lengths",
  ),
);

export const WorkspaceSchema = v.object({
  repoRoot: NonEmpty,
  branch: NonEmpty,
  rootCommit: v.optional(NonEmpty),
  remote: v.optional(NonEmpty),
} satisfies EntriesOf<WorkspaceKey>);

export const ArtifactMetaSchema = v.object({
  workflow: v.optional(v.picklist(WORKFLOW_KINDS)),
  cwd: v.optional(v.string()),
  agent: v.optional(v.string()),
  agentSessionId: v.optional(v.string()),
  planPath: v.optional(v.string()),
  prototypePath: v.optional(v.string()),
  pr: v.optional(v.string()),
  herdrPane: v.optional(v.string()),
  title: v.optional(v.string()),
  workbench: v.optional(v.boolean()),
  snapshot: v.optional(v.boolean()),
} satisfies EntriesOf<ArtifactMeta>);

export const DiffFileContentsSchema = v.object({
  path: NonEmpty,
  oldContents: v.string(),
  newContents: v.string(),
  status: v.picklist(["added", "modified", "deleted"]),
} satisfies EntriesOf<DiffFileContents>);

export const ArtifactSchema = v.object({
  // Derived from the schema's runtime union: a new primitive extends the wire
  // contract without touching this file.
  type: v.picklist(ARTIFACT_TYPES),
  content: v.string(),
  meta: v.optional(ArtifactMetaSchema, {}),
  files: v.optional(v.array(DiffFileContentsSchema)),
} satisfies EntriesOf<Artifact>);

export const AnchorSchema = v.object({
  quote: v.string(),
  prefix: v.optional(v.string(), ""),
  suffix: v.optional(v.string(), ""),
  blockIndex: v.optional(v.number()),
  endBlockIndex: v.optional(v.number()),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
  selector: v.optional(v.string()),
} satisfies EntriesOf<Anchor>);

/** The surface a note was made on; absent means the reviewed artifact. */
export const AnnotationTargetSchema: v.GenericSchema<AnnotationTarget> = v.variant("kind", [
  v.object({ kind: v.literal("artifact") }),
  v.object({ kind: v.literal("file"), path: NonEmpty, rev: v.picklist(["worktree", "head"]) }),
  v.object({ kind: v.literal("welcome") }),
]);

/** Wire annotations arrive without createdAt - the daemon stamps it. */
export const AnnotationSchema = v.object({
  id: NonEmpty,
  /** Open kind set: the built-in is comment. */
  kind: NonEmpty,
  anchor: AnchorSchema,
  target: v.optional(AnnotationTargetSchema),
  body: v.string(),
  orphan: v.optional(v.boolean()),
  author: v.optional(v.string()),
  replyTo: v.optional(NonEmpty),
  resolution: v.optional(
    v.object({
      revision: v.number(),
      source: v.picklist(["agent", "drift"]),
    }),
  ),
} satisfies EntriesOf<Omit<Annotation, "createdAt">>);

const SessionId = NonEmpty;

/** A stored annotation: the wire shape plus the daemon-stamped createdAt. */
export const FullAnnotationSchema = v.object({
  ...AnnotationSchema.entries,
  createdAt: v.string(),
} satisfies EntriesOf<Annotation>);

export const IdentitySchema = v.object({
  id: NonEmpty,
  provider: v.picklist(["ssh", "github"]),
  name: v.optional(v.string()),
  handle: v.optional(v.string()),
} satisfies EntriesOf<Identity>);

export const ShareLinkSchema = v.object({
  id: NonEmpty,
  name: v.optional(v.string()),
  requireAuth: v.boolean(),
  allowlist: v.array(NonEmpty),
  owner: v.optional(v.string()),
  shareBranch: v.optional(v.string()),
} satisfies EntriesOf<ShareLink>);

export const HarnessBindingSchema = v.object({
  id: NonEmpty,
  threadId: NonEmpty,
  harness: NonEmpty,
  harnessSessionId: NonEmpty,
  createdAt: NonEmpty,
  approvedRetryMessageId: v.optional(NonEmpty),
} satisfies EntriesOf<HarnessBinding>);

export const DeliverySchema = v.object({
  id: NonEmpty,
  messageId: NonEmpty,
  bindingId: NonEmpty,
  status: v.picklist(["pending", "acknowledged"]),
  createdAt: NonEmpty,
  acknowledgedAt: v.optional(NonEmpty),
} satisfies EntriesOf<Delivery>);

export const Params = {
  "session.create": v.object({ workspace: WorkspaceSchema, artifact: ArtifactSchema }),
  "session.get": v.object({ id: SessionId }),
  "session.list": v.object({
    filter: v.optional(
      v.object({
        status: v.optional(v.picklist(["pending", "resolved"])),
        workspace: v.optional(v.partial(WorkspaceSchema)),
      }),
    ),
  }),
  "session.wait": v.object({
    id: SessionId,
    // clamped: a negative or absurd timeout is a client bug, not a daemon one
    timeoutMs: v.optional(
      v.pipe(v.number(), v.minValue(0), v.maxValue(24 * 60 * 60 * 1000)),
      60_000,
    ),
  }),
  "session.annotate": v.object({
    id: SessionId,
    annotation: AnnotationSchema,
    authorName: v.optional(v.string()),
  }),
  // "session.comment" is the primary annotate method; "session.annotate" stays an accepted alias
  "session.comment": v.object({
    id: SessionId,
    annotation: AnnotationSchema,
    authorName: v.optional(v.string()),
  }),
  "session.removeAnnotation": v.object({ id: SessionId, annotationId: NonEmpty }),
  "session.setParticipantName": v.object({ id: SessionId, author: NonEmpty, name: NonEmpty }),
  "session.setWorkingCopy": v.object({
    id: SessionId,
    workingCopy: v.optional(v.string()),
    textCuts: v.optional(TextCutsSchema),
  }),
  "session.cutBlock": v.object({
    id: SessionId,
    blockIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
  "session.restoreBlock": v.object({
    id: SessionId,
    baseBlockIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
    line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
  "session.curate": v.object({
    id: SessionId,
    rejections: v.array(
      v.object({
        path: NonEmpty,
        hunkIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
        changeIndex: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
      } satisfies EntriesOf<HunkRejection>),
    ),
  }),
  "session.setViewed": v.object({ id: SessionId, viewedPaths: v.array(v.string()) }),
  "session.setTitle": v.object({ id: SessionId, title: v.string() }),
  "session.projectFiles": v.object({ id: SessionId }),
  "session.fileContents": v.object({ id: SessionId, path: NonEmpty }),
  "repo.files": v.object({ cwd: NonEmpty }),
  "repo.fileContents": v.object({ cwd: NonEmpty, path: NonEmpty }),
  "repo.changes": v.object({ cwd: NonEmpty }),
  "repo.diff": v.object({ cwd: NonEmpty }),
  "session.workbench": v.object({ cwd: NonEmpty }),
  "session.navigate": v.object({
    id: SessionId,
    entryId: NonEmpty,
    summary: v.optional(v.string()),
    // stand on this branch first, so a move on another branch is one request
    branch: v.optional(NonEmpty),
  }),
  "session.branch": v.object({ id: SessionId, name: NonEmpty }),
  "session.switch": v.object({ id: SessionId, branch: NonEmpty }),
  "session.label": v.object({ id: SessionId, label: NonEmpty }),
  "session.fork": v.object({ id: SessionId }),
  "session.refreshDiff": v.object({ id: SessionId }),
  "session.setShareId": v.object({ id: SessionId, shareId: NonEmpty }),
  "session.setShares": v.object({ id: SessionId, shares: v.array(ShareLinkSchema) }),
  "session.setAccess": v.object({ id: SessionId, githubLogins: v.array(NonEmpty) }),
  "session.delete": v.object({ id: SessionId }),
  "session.mergeShared": v.object({
    id: SessionId,
    annotations: v.array(FullAnnotationSchema),
    participants: v.optional(v.array(IdentitySchema)),
    // the removal entries a share recorded, carried by id so a merge applies each once
    removals: v.optional(
      v.array(v.object({ id: NonEmpty, annotationId: NonEmpty, createdAt: v.string() })),
    ),
  }),
  "session.sendMessage": v.object({
    id: SessionId,
    outcome: v.picklist(MESSAGE_OUTCOMES),
    summary: v.optional(v.string(), ""),
    actionBodies: v.optional(v.record(v.string(), v.string())),
  }),
  "harness.bind": v.object({
    threadId: SessionId,
    harness: NonEmpty,
    harnessSessionId: NonEmpty,
  }),
  "harness.getBinding": v.object({ bindingId: NonEmpty }),
  "harness.bindingsForSession": v.object({ harness: NonEmpty, harnessSessionId: NonEmpty }),
  "harness.consumeApprovedRetry": v.object({
    bindingId: NonEmpty,
    messageId: NonEmpty,
    content: v.string(),
  }),
  "delivery.pending": v.object({ bindingId: NonEmpty }),
  "delivery.acknowledge": v.object({ deliveryId: NonEmpty }),
  "session.submitRevision": v.object({
    id: SessionId,
    content: v.string(),
    files: v.optional(v.array(DiffFileContentsSchema)),
    /** Annotation ids the agent acted on; each is marked addressed. */
    addressedAnnotationIds: v.optional(v.array(NonEmpty), []),
  }),
  "events.subscribe": v.object({}),
  "daemon.ping": v.object({}),
  // the owner token proves ownership; without it a request for owner stays a collaborator
  "daemon.hello": v.object({
    role: v.picklist(["owner", "collaborator", "agent"]),
    clientVersion: v.optional(v.string()),
    token: v.optional(v.string()),
    // the author a non-owner acts as, bound once for the connection
    author: v.optional(NonEmpty),
  }),
  "daemon.shutdown": v.object({}),
  // Herdr terminal handles stay outside canonical Thread records.
  "herdr.getThreadSurface": v.object({ id: SessionId }),
  "herdr.setThreadSurface": v.object({
    id: SessionId,
    tabId: NonEmpty,
    paneId: NonEmpty,
    mode: v.optional(v.picklist(["tab", "pane"])),
  }),
  "ghostty.getThreadSurface": v.object({ id: SessionId }),
  "ghostty.setThreadSurface": v.object({ id: SessionId, terminalId: NonEmpty }),
  "ghostty.claimThreadSurface": v.object({ id: SessionId }),
  "ghostty.releaseThreadSurface": v.object({ id: SessionId }),
} as const;

export type MethodName = keyof typeof Params;

export function isKnownMethod(method: string): method is MethodName {
  return method in Params;
}

/** Validate params for a method, or throw a DaemonError the client can read. */
export function parseParams<M extends MethodName>(
  method: M,
  params: Request["params"],
): v.InferOutput<(typeof Params)[M]> {
  const result = v.safeParse(Params[method], params ?? {});

  if (!result.success) {
    const issue = result.issues[0]!;
    const path = issue.path?.map((pathSegment) => String(pathSegment.key)).join(".") ?? "";

    throw new DaemonError(
      "invalid_params",
      `${method}: ${path ? path + " - " : ""}${issue.message}`,
    );
  }

  return result.output;
}

export const RevisionSchema = v.object({
  revision: v.number(),
  content: v.string(),
  submittedAt: v.string(),
} satisfies EntriesOf<Revision>);

export const MessageSchema = v.object({
  id: NonEmpty,
  outcome: v.picklist(MESSAGE_OUTCOMES),
  summary: v.string(),
  body: v.string(),
  annotations: v.optional(v.array(FullAnnotationSchema)),
  sentAt: v.string(),
} satisfies EntriesOf<Message>);

export const PendingDeliverySchema = v.object({
  delivery: DeliverySchema,
  message: MessageSchema,
} satisfies EntriesOf<PendingDelivery>);

const EntryBaseEntries = {
  id: NonEmpty,
  parentId: v.nullable(NonEmpty),
  createdAt: v.string(),
};

/** One record of a session's history; the tree pointers plus the entry's own fields. */
export const SessionEntrySchema = v.variant("type", [
  v.object({
    ...EntryBaseEntries,
    type: v.literal("revision"),
    by: v.picklist(["agent", "reviewer"]),
    content: v.string(),
    textCuts: v.optional(TextCutsSchema),
  }),
  v.object({ ...EntryBaseEntries, type: v.literal("comment"), annotationId: NonEmpty }),
  v.object({ ...EntryBaseEntries, type: v.literal("comment-removed"), annotationId: NonEmpty }),
  v.object({ ...EntryBaseEntries, type: v.literal("message"), message: MessageSchema }),
  v.object({
    ...EntryBaseEntries,
    type: v.literal("branch-summary"),
    text: v.string(),
    abandoned: v.array(NonEmpty),
  }),
]);

export const SessionHistorySchema = v.pipe(
  v.object({
    entries: v.array(SessionEntrySchema),
    tips: v.record(v.string(), NonEmpty),
    branch: NonEmpty,
    labels: v.record(v.string(), v.string()),
  } satisfies EntriesOf<SessionHistory>),
  // the shape is not enough: the tree itself must hold, or a walk hangs or rewires the path
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const problem = validateHistory(dataset.value);

    if (problem !== null) addIssue({ message: `history: ${problem}` });
  }),
);

/** Persisted records are validated on recovery: a bad file is skipped, not fatal. */
export const ThreadRecordSchema = v.pipe(
  v.object({
    schemaVersion: v.literal(SCHEMA_VERSION),
    id: NonEmpty,
    workspace: WorkspaceSchema,
    artifact: ArtifactSchema,
    revisions: v.array(RevisionSchema),
    annotations: v.array(FullAnnotationSchema),
    history: v.optional(SessionHistorySchema),
    curation: v.optional(
      v.array(
        v.object({
          path: NonEmpty,
          hunkIndex: v.number(),
          changeIndex: v.optional(v.number()),
        } satisfies EntriesOf<HunkRejection>),
      ),
    ),
    workingCopy: v.optional(v.string()),
    textCuts: v.optional(TextCutsSchema),
    viewedPaths: v.optional(v.array(v.string())),
    message: v.nullable(MessageSchema),
    status: v.picklist(["pending", "resolved"]),
    createdAt: v.string(),
    shelvedAnnotations: v.optional(v.array(FullAnnotationSchema)),
    parentSessionId: v.optional(v.string()),
    shares: v.optional(v.array(ShareLinkSchema)),
    shareId: v.optional(v.string()),
    shareBranch: v.optional(v.string()),
    owner: v.optional(v.string()),
    access: v.optional(
      v.object({ githubLogins: v.array(NonEmpty) } satisfies EntriesOf<ShareAccess>),
    ),
    participants: v.optional(v.array(IdentitySchema)),
  } satisfies EntriesOf<Thread>),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed || !dataset.value.textCuts?.length) return;
    const { artifact, textCuts, workingCopy } = dataset.value;
    const matchesSource = textCuts.every(
      (cut) => artifact.content.slice(cut.start, cut.end) === cut.quote,
    );

    if (!matchesSource || workingCopy !== applyTextCuts(artifact.content, textCuts)) {
      addIssue({ message: "text Cuts do not match the submitted artifact and working copy" });
    }
  }),
);

export function validateThreadRecord(
  raw: Parameters<typeof v.safeParse>[1],
): { ok: true; value: v.InferOutput<typeof ThreadRecordSchema> } | { ok: false; error: string } {
  const result = v.safeParse(ThreadRecordSchema, raw);

  if (result.success) return { ok: true, value: result.output };
  const issue = result.issues[0]!;
  const path = issue.path?.map((pathSegment) => String(pathSegment.key)).join(".") ?? "";

  return { ok: false, error: `${path ? path + ": " : ""}${issue.message}` };
}

/** @deprecated use ThreadRecordSchema */
export const SessionRecordSchema = ThreadRecordSchema;
/** @deprecated use validateThreadRecord */
export const validateSessionRecord = validateThreadRecord;
