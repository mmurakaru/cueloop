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
  SCHEMA_VERSION,
  type Anchor,
  type Annotation,
  type Artifact,
  type ArtifactMeta,
  type DiffFileContents,
  type Identity,
  type ReviewSession,
  type Revision,
  type Verdict,
  type WorkspaceKey,
} from "@cueloop/schema";
import { DaemonError } from "./errors";

/**
 * Drift guard for every hand-mirrored shape below. v.object strips keys it
 * does not know, so a schema missing a field silently drops that field on
 * the way into DaemonCore. Each entries object is checked with
 * `satisfies EntriesOf<T>`: adding a field to the schema types without
 * mirroring it here (or mirroring a key that does not exist) fails typecheck.
 */
type EntriesOf<T> = { [K in keyof T]-?: v.GenericSchema<any, any> };

const NonEmpty = v.pipe(v.string(), v.minLength(1));

export const WorkspaceSchema = v.object({
  repoRoot: NonEmpty,
  branch: NonEmpty,
} satisfies EntriesOf<WorkspaceKey>);

export const ArtifactMetaSchema = v.object({
  cwd: v.optional(v.string()),
  agent: v.optional(v.string()),
  agentSessionId: v.optional(v.string()),
  planPath: v.optional(v.string()),
  prototypePath: v.optional(v.string()),
  pr: v.optional(v.string()),
  herdrPane: v.optional(v.string()),
  title: v.optional(v.string()),
} satisfies EntriesOf<ArtifactMeta>);

export const DiffFileContentsSchema = v.object({
  path: NonEmpty,
  oldContents: v.string(),
  newContents: v.string(),
  status: v.picklist(["added", "modified", "deleted"]),
} satisfies EntriesOf<DiffFileContents>);

export const ArtifactSchema = v.object({
  type: v.picklist(["plan", "diff", "prototype"]),
  content: v.string(),
  meta: v.optional(ArtifactMetaSchema, {}),
  files: v.optional(v.array(DiffFileContentsSchema)),
} satisfies EntriesOf<Artifact>);

export const AnchorSchema = v.object({
  quote: v.string(),
  prefix: v.optional(v.string(), ""),
  suffix: v.optional(v.string(), ""),
  blockIndex: v.optional(v.number()),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
  selector: v.optional(v.string()),
} satisfies EntriesOf<Anchor>);

/** Wire annotations arrive without createdAt - the daemon stamps it. */
export const AnnotationSchema = v.object({
  id: NonEmpty,
  /** Open kind set: the built-in is comment. */
  kind: NonEmpty,
  anchor: AnchorSchema,
  body: v.string(),
  orphan: v.optional(v.boolean()),
  author: v.optional(v.string()),
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
  provider: v.literal("ssh"),
  name: v.optional(v.string()),
  handle: v.optional(v.string()),
} satisfies EntriesOf<Identity>);

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
  "session.removeAnnotation": v.object({ id: SessionId, annotationId: NonEmpty }),
  "session.setWorkingCopy": v.object({ id: SessionId, workingCopy: v.optional(v.string()) }),
  "session.setViewed": v.object({ id: SessionId, viewedPaths: v.array(v.string()) }),
  "session.refreshDiff": v.object({ id: SessionId }),
  "session.setShareId": v.object({ id: SessionId, shareId: NonEmpty }),
  "session.delete": v.object({ id: SessionId }),
  "session.mergeShared": v.object({
    id: SessionId,
    annotations: v.array(FullAnnotationSchema),
    participants: v.optional(v.array(IdentitySchema)),
  }),
  "session.resolve": v.object({
    id: SessionId,
    verdictKind: v.picklist(["comment", "approve", "request_changes"]),
    summary: v.optional(v.string(), ""),
  }),
  "session.submitRevision": v.object({
    id: SessionId,
    content: v.string(),
    /** Annotation ids the agent acted on; each is marked addressed. */
    addressedAnnotationIds: v.optional(v.array(NonEmpty), []),
  }),
  "events.subscribe": v.object({}),
  "daemon.ping": v.object({}),
  "daemon.hello": v.object({ role: v.picklist(["owner", "collaborator", "agent"]) }),
  "daemon.shutdown": v.object({}),
  // herdr adapter scratch: the review's opened tab, kept off the session record.
  "herdr.getTab": v.object({ id: SessionId }),
  "herdr.setTab": v.object({ id: SessionId, tabId: NonEmpty, paneId: NonEmpty }),
} as const;

export type MethodName = keyof typeof Params;

export function isKnownMethod(method: string): method is MethodName {
  return method in Params;
}

/** Validate params for a method, or throw a DaemonError the client can read. */
export function parseParams<M extends MethodName>(
  method: M,
  params: unknown,
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

export const VerdictSchema = v.object({
  kind: v.picklist(["comment", "approve", "request_changes"]),
  summary: v.string(),
  feedback: v.string(),
  resolvedAt: v.string(),
} satisfies EntriesOf<Verdict>);

/** Persisted records are validated on recovery: a bad file is skipped, not fatal. */
export const SessionRecordSchema = v.object({
  schemaVersion: v.literal(SCHEMA_VERSION),
  id: NonEmpty,
  workspace: WorkspaceSchema,
  artifact: ArtifactSchema,
  revisions: v.array(RevisionSchema),
  annotations: v.array(FullAnnotationSchema),
  workingCopy: v.optional(v.string()),
  viewedPaths: v.optional(v.array(v.string())),
  verdict: v.nullable(VerdictSchema),
  status: v.picklist(["pending", "resolved"]),
  createdAt: v.string(),
  shareId: v.optional(v.string()),
  owner: v.optional(v.string()),
  participants: v.optional(v.array(IdentitySchema)),
} satisfies EntriesOf<ReviewSession>);

export function validateSessionRecord(
  raw: unknown,
): { ok: true; value: v.InferOutput<typeof SessionRecordSchema> } | { ok: false; error: string } {
  const result = v.safeParse(SessionRecordSchema, raw);
  if (result.success) return { ok: true, value: result.output };
  const issue = result.issues[0]!;
  const path = issue.path?.map((pathSegment) => String(pathSegment.key)).join(".") ?? "";
  return { ok: false, error: `${path ? path + ": " : ""}${issue.message}` };
}
