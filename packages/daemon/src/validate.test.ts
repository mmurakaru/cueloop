import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore } from "./api";
import { DaemonError } from "./errors";
import {
  AnchorSchema,
  AnnotationSchema,
  ArtifactMetaSchema,
  ArtifactSchema,
  IdentitySchema,
  RevisionSchema,
  SessionRecordSchema,
  VerdictSchema,
  WorkspaceSchema,
  isKnownMethod,
  parseParams,
  validateSessionRecord,
} from "./validate";
import {
  ARTIFACT_TYPES,
  SCHEMA_VERSION,
  type Anchor,
  type Annotation,
  type Artifact,
  type ArtifactMeta,
  type Identity,
  type ReviewSession,
  type Revision,
  type Verdict,
  type WorkspaceKey,
} from "@cueloop/schema";

describe("method allowlist", () => {
  test("known and unknown methods", () => {
    expect(isKnownMethod("session.create")).toBe(true);
    expect(isKnownMethod("session.destroyEverything")).toBe(false);
  });
});

describe("parseParams", () => {
  test("accepts a well-formed create and defaults meta", () => {
    // Act
    const params = parseParams("session.create", {
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "# P" },
    });

    // Assert
    expect(params.artifact.meta).toEqual({});
  });

  test("rejects a missing workspace with a pathed message", () => {
    try {
      parseParams("session.create", { artifact: { type: "plan", content: "" } });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonError);
      if (err instanceof DaemonError) {
        expect(err.code).toBe("invalid_params");
        expect(err.message).toContain("session.create: workspace");
      }
    }
  });

  test("accepts every artifact type in the schema union", () => {
    for (const type of ARTIFACT_TYPES) {
      const params = parseParams("session.create", {
        workspace: { repoRoot: "/repo", branch: "main" },
        artifact: { type, content: "body" },
      });

      expect(params.artifact.type).toBe(type);
    }
  });

  test("rejects an unknown artifact type", () => {
    expect(() =>
      parseParams("session.create", {
        workspace: { repoRoot: "/r", branch: "b" },
        artifact: { type: "spreadsheet", content: "" },
      }),
    ).toThrow(/artifact.type/);
  });

  test("rejects an empty session id", () => {
    expect(() => parseParams("session.get", { id: "" })).toThrow(/invalid|id/i);
  });

  test("defaults and clamps the wait timeout", () => {
    expect(parseParams("session.wait", { id: "ses_1" }).timeoutMs).toBe(60_000);
    expect(() => parseParams("session.wait", { id: "ses_1", timeoutMs: -5 })).toThrow();
    expect(() =>
      parseParams("session.wait", { id: "ses_1", timeoutMs: 99 * 60 * 60 * 1000 }),
    ).toThrow();
  });

  test("verdict kinds are closed", () => {
    expect(parseParams("session.resolve", { id: "s", verdictKind: "approve" }).summary).toBe("");
    expect(() => parseParams("session.resolve", { id: "s", verdictKind: "lgtm" })).toThrow(
      /verdictKind/,
    );
  });

  test("annotation kinds stay open (extension kinds are allowed)", () => {
    // Act
    const params = parseParams("session.annotate", {
      id: "s",
      annotation: { id: "a1", kind: "praise", anchor: { quote: "x" }, body: "nice" },
    });

    // Assert
    expect(params.annotation.kind).toBe("praise");
    expect(params.annotation.anchor.prefix).toBe("");
  });

  test("setViewed takes a full path list and rejects non-string entries", () => {
    expect(
      parseParams("session.setViewed", { id: "s", viewedPaths: ["src/a.ts", "src/b.ts"] })
        .viewedPaths,
    ).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseParams("session.setViewed", { id: "s", viewedPaths: [] }).viewedPaths).toEqual([]);
    expect(() => parseParams("session.setViewed", { id: "s", viewedPaths: [1] })).toThrow(
      /viewedPaths/,
    );
    expect(() => parseParams("session.setViewed", { id: "s" })).toThrow(/viewedPaths/);
  });

  test("null params are treated as empty", () => {
    expect(parseParams("daemon.ping", null)).toEqual({});
  });
});

describe("validateSessionRecord", () => {
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/r", branch: "main" },
    artifact: { type: "plan", content: "# P", meta: {} },
    revisions: [{ revision: 1, content: "# P", submittedAt: "now" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "now",
  };

  test("accepts a valid record", () => {
    expect(validateSessionRecord(record).ok).toBe(true);
  });

  test("rejects a foreign schema version with a readable reason", () => {
    // Act
    const result = validateSessionRecord({ ...record, schemaVersion: "99" });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("schemaVersion");
  });

  test("rejects a structurally broken record", () => {
    // Act
    const result = validateSessionRecord({ ...record, revisions: "nope" });

    // Assert
    expect(result.ok).toBe(false);
  });
});

/**
 * Wire pins: every schema's entries must cover exactly the keys of the
 * schema type it mirrors. Runtime complement to the compile-time EntriesOf
 * check - the samples are fully populated and typed, so a new field in
 * @cueloop/schema shows up here too.
 */
describe("wire pins", () => {
  const keys = <Subject extends object>(subject: Subject) => Object.keys(subject).sort();
  const entryKeys = (schema: { entries: object }) => Object.keys(schema.entries).sort();

  const fullMeta: Required<ArtifactMeta> = {
    cwd: "/repo",
    agent: "claude-code",
    agentSessionId: "sess-1",
    planPath: "/repo/plan.md",
    prototypePath: "/repo/proto.html",
    pr: "org/repo#1",
    herdrPane: "%7",
    title: "Plan",
  };
  const fullAnchor: Required<Anchor> = {
    quote: "q",
    prefix: "p",
    suffix: "s",
    blockIndex: 0,
    endBlockIndex: 0,
    start: 0,
    end: 1,
    selector: "div.card",
  };
  const fullAnnotation: Required<Annotation> = {
    id: "a1",
    kind: "comment",
    anchor: fullAnchor,
    body: "b",
    orphan: false,
    author: "SHA256:abc",
    replyTo: "a0",
    resolution: { revision: 2, source: "agent" },
    createdAt: "now",
  };
  const fullArtifact: Required<Artifact> = {
    type: "plan",
    content: "# P",
    meta: fullMeta,
    files: [{ path: "src/a.ts", oldContents: "old\n", newContents: "new\n", status: "modified" }],
  };
  const fullVerdict: Required<Verdict> = {
    kind: "approve",
    summary: "",
    feedback: "",
    resolvedAt: "now",
  };
  const fullRevision: Required<Revision> = { revision: 1, content: "# P", submittedAt: "now" };
  const fullWorkspace: Required<WorkspaceKey> = { repoRoot: "/repo", branch: "main" };
  const fullIdentity: Required<Identity> = {
    id: "SHA256:abc",
    provider: "ssh",
    name: "Al",
    handle: "abc",
  };
  const fullSession: Required<ReviewSession> = {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: fullWorkspace,
    artifact: fullArtifact,
    revisions: [fullRevision],
    annotations: [fullAnnotation],
    history: {
      entries: [
        {
          id: "e1",
          parentId: null,
          type: "revision",
          by: "agent",
          content: "# P",
          createdAt: "now",
        },
        { id: "e2", parentId: "e1", type: "comment", annotationId: "a1", createdAt: "now" },
        { id: "e3", parentId: "e2", type: "comment-removed", annotationId: "a1", createdAt: "now" },
        { id: "e4", parentId: "e3", type: "verdict", verdict: fullVerdict, createdAt: "now" },
        {
          id: "e5",
          parentId: "e4",
          type: "branch-summary",
          text: "tried a thing",
          abandoned: ["e3"],
          createdAt: "now",
        },
      ],
      tips: { main: "e5" },
      branch: "main",
      labels: { e1: "start" },
    },
    workingCopy: "# P edited",
    viewedPaths: ["src/a.ts"],
    verdict: fullVerdict,
    status: "pending",
    createdAt: "now",
    shareId: "p_abc123xy",
    owner: "SHA256:owner",
    participants: [fullIdentity],
  };

  test("a history whose tree is broken is refused even when every entry is well-formed", () => {
    // Arrange: a parent cycle
    const record = {
      ...fullSession,
      history: {
        entries: [
          { id: "a", parentId: "b", type: "revision", by: "agent", content: "x", createdAt: "now" },
          { id: "b", parentId: "a", type: "comment", annotationId: "a1", createdAt: "now" },
        ],
        tips: { main: "b" },
        branch: "main",
        labels: {},
      },
    };

    // Act
    const parsed = validateSessionRecord(record);

    // Assert
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("history:");
  });

  test("schema key sets match the schema types", () => {
    expect(entryKeys(WorkspaceSchema)).toEqual(keys(fullWorkspace));
    expect(entryKeys(ArtifactMetaSchema)).toEqual(keys(fullMeta));
    expect(entryKeys(ArtifactSchema)).toEqual(keys(fullArtifact));
    expect(entryKeys(AnchorSchema)).toEqual(keys(fullAnchor));
    // wire annotations arrive without createdAt; the daemon stamps it
    const { createdAt: _stamped, ...wireAnnotation } = fullAnnotation;

    expect(entryKeys(AnnotationSchema)).toEqual(keys(wireAnnotation));
    expect(entryKeys(RevisionSchema)).toEqual(keys(fullRevision));
    expect(entryKeys(VerdictSchema)).toEqual(keys(fullVerdict));
    expect(entryKeys(IdentitySchema)).toEqual(keys(fullIdentity));
    expect(entryKeys(SessionRecordSchema)).toEqual(keys(fullSession));
    // persisted annotations carry the stamped createdAt
    const stored = SessionRecordSchema.entries.annotations.item;

    expect(entryKeys(stored)).toEqual(keys(fullAnnotation));
  });

  test("a fully-populated meta survives validation and DaemonCore unchanged", () => {
    const home = mkdtempSync(join(tmpdir(), "cueloop-val-"));

    try {
      // Arrange
      const params = parseParams("session.create", {
        workspace: fullWorkspace,
        artifact: { type: "plan", content: "# P", meta: fullMeta },
      });
      const core = new DaemonCore(home);

      // Act
      const created = core.sessionCreate(params);

      // Assert
      expect(core.sessionGet(created.id).artifact.meta).toEqual(fullMeta);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
