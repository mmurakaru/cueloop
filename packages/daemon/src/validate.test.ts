import { describe, expect, test } from "bun:test";
import { DaemonError } from "./errors";
import { isKnownMethod, parseParams, validateSessionRecord } from "./validate";
import { SCHEMA_VERSION } from "@cueloop/schema";

describe("method allowlist", () => {
  test("known and unknown methods", () => {
    expect(isKnownMethod("session.create")).toBe(true);
    expect(isKnownMethod("session.destroyEverything")).toBe(false);
  });
});

describe("parseParams", () => {
  test("accepts a well-formed create and defaults meta", () => {
    const p = parseParams("session.create", {
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "# P" },
    });
    expect(p.artifact.meta).toEqual({});
  });

  test("rejects a missing workspace with a pathed message", () => {
    try {
      parseParams("session.create", { artifact: { type: "plan", content: "" } });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonError);
      expect((err as DaemonError).code).toBe("invalid_params");
      expect((err as DaemonError).message).toContain("session.create: workspace");
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
    expect(() => parseParams("session.wait", { id: "ses_1", timeoutMs: 99 * 60 * 60 * 1000 })).toThrow();
  });

  test("verdict kinds are closed", () => {
    expect(parseParams("session.resolve", { id: "s", verdictKind: "approve" }).summary).toBe("");
    expect(() => parseParams("session.resolve", { id: "s", verdictKind: "lgtm" })).toThrow(/verdictKind/);
  });

  test("annotation kinds stay open (extension kinds are allowed)", () => {
    const p = parseParams("session.annotate", {
      id: "s",
      annotation: { id: "a1", kind: "praise", anchor: { quote: "x" }, body: "nice" },
    });
    expect(p.annotation.kind).toBe("praise");
    expect(p.annotation.anchor.prefix).toBe("");
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
    const r = validateSessionRecord({ ...record, schemaVersion: "99" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("schemaVersion");
  });

  test("rejects a structurally broken record", () => {
    const r = validateSessionRecord({ ...record, revisions: "nope" });
    expect(r.ok).toBe(false);
  });
});
