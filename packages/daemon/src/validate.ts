/**
 * Runtime validation of the wire boundary (#14). Everything arriving over the
 * socket is untrusted JSON: adapters, the CLI, extensions, and any script a
 * user writes all speak this protocol. Validating here means DaemonCore only
 * ever sees well-formed input, and a malformed request gets a precise error
 * instead of a downstream crash.
 *
 * valibot is cueloop's validation library - modular, tiny, and tree-shakeable,
 * which matters for a CLI whose startup latency the user feels on every review.
 */

import * as v from "valibot";
import { SCHEMA_VERSION } from "@cueloop/schema";
import { DaemonError } from "./errors";

const NonEmpty = v.pipe(v.string(), v.minLength(1));

export const WorkspaceSchema = v.object({
  repoRoot: NonEmpty,
  branch: NonEmpty,
});

export const ArtifactSchema = v.object({
  type: v.picklist(["plan", "diff"]),
  content: v.string(),
  meta: v.optional(
    v.object({
      cwd: v.optional(v.string()),
      agent: v.optional(v.string()),
      agentSessionId: v.optional(v.string()),
      planPath: v.optional(v.string()),
      title: v.optional(v.string()),
      pr: v.optional(v.string()),
    }),
    {},
  ),
});

export const AnchorSchema = v.object({
  quote: v.string(),
  prefix: v.optional(v.string(), ""),
  suffix: v.optional(v.string(), ""),
  blockIndex: v.optional(v.number()),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
});

export const AnnotationSchema = v.object({
  id: NonEmpty,
  /** Open kind set (#2): built-ins are comment and suggestion. */
  kind: NonEmpty,
  anchor: AnchorSchema,
  body: v.string(),
  orphan: v.optional(v.boolean()),
});

const SessionId = NonEmpty;

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
    timeoutMs: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(24 * 60 * 60 * 1000)), 60_000),
  }),
  "session.annotate": v.object({ id: SessionId, annotation: AnnotationSchema }),
  "session.removeAnnotation": v.object({ id: SessionId, annotationId: NonEmpty }),
  "session.setWorkingCopy": v.object({ id: SessionId, workingCopy: v.optional(v.string()) }),
  "session.resolve": v.object({
    id: SessionId,
    verdictKind: v.picklist(["comment", "approve", "request_changes"]),
    summary: v.optional(v.string(), ""),
  }),
  "session.submitRevision": v.object({ id: SessionId, content: v.string() }),
  "events.subscribe": v.object({}),
  "daemon.ping": v.object({}),
  "daemon.shutdown": v.object({}),
} as const;

export type MethodName = keyof typeof Params;

export function isKnownMethod(method: string): method is MethodName {
  return method in Params;
}

/** Validate params for a method, or throw a DaemonError the client can read. */
export function parseParams<M extends MethodName>(method: M, params: unknown): v.InferOutput<(typeof Params)[M]> {
  const result = v.safeParse(Params[method], params ?? {});
  if (!result.success) {
    const issue = result.issues[0]!;
    const path = issue.path?.map((p) => String(p.key)).join(".") ?? "";
    throw new DaemonError("invalid_params", `${method}: ${path ? path + " - " : ""}${issue.message}`);
  }
  return result.output;
}

/** Persisted records are validated on recovery: a bad file is skipped, not fatal. */
export const SessionRecordSchema = v.object({
  schemaVersion: v.literal(SCHEMA_VERSION),
  id: NonEmpty,
  workspace: WorkspaceSchema,
  artifact: ArtifactSchema,
  revisions: v.array(v.object({ revision: v.number(), content: v.string(), submittedAt: v.string() })),
  annotations: v.array(v.object({ ...AnnotationSchema.entries, createdAt: v.string() })),
  workingCopy: v.optional(v.string()),
  verdict: v.nullable(
    v.object({
      kind: v.picklist(["comment", "approve", "request_changes"]),
      summary: v.string(),
      feedback: v.string(),
      resolvedAt: v.string(),
    }),
  ),
  status: v.picklist(["pending", "resolved"]),
  createdAt: v.string(),
});

export function validateSessionRecord(raw: unknown): { ok: true; value: v.InferOutput<typeof SessionRecordSchema> } | { ok: false; error: string } {
  const result = v.safeParse(SessionRecordSchema, raw);
  if (result.success) return { ok: true, value: result.output };
  const issue = result.issues[0]!;
  const path = issue.path?.map((p) => String(p.key)).join(".") ?? "";
  return { ok: false, error: `${path ? path + ": " : ""}${issue.message}` };
}
