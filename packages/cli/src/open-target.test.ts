/**
 * Verb-first open resolution over a plain session list: latest-pending default,
 * by-id, and fuzzy-by-title (exact wins, unique substring wins, else
 * ambiguous). No daemon and no TUI - the resolver is pure over the array.
 */

import { describe, expect, test } from "bun:test";
import type { ArtifactType, ReviewSession } from "@cueloop/schema";
import { openTargetMessage, resolveOpenTarget } from "./open-target";

function session(overrides: {
  id: string;
  type?: ArtifactType;
  title?: string;
  status?: "pending" | "resolved";
  createdAt?: string;
  pr?: string;
}): ReviewSession {
  return {
    schemaVersion: "1",
    id: overrides.id,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: overrides.type ?? "plan",
      content: "",
      meta: { title: overrides.title, pr: overrides.pr },
    },
    revisions: [],
    annotations: [],
    verdict: overrides.status === "resolved" ? { kind: "approve", summary: "", feedback: "", resolvedAt: "" } : null,
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

const isPlan = (candidate: ReviewSession) => candidate.artifact.type === "plan";

describe("resolveOpenTarget: latest pending default", () => {
  test("picks the most recent pending session in scope", () => {
    const sessions = [
      session({ id: "ses_old", createdAt: "2026-01-01T00:00:00.000Z" }),
      session({ id: "ses_new", createdAt: "2026-03-01T00:00:00.000Z" }),
      session({ id: "ses_mid", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(resolveOpenTarget(sessions, { match: isPlan })).toEqual({ kind: "session", sessionId: "ses_new" });
  });

  test("ignores resolved sessions and other artifact types", () => {
    const sessions = [
      session({ id: "ses_resolved", createdAt: "2026-05-01T00:00:00.000Z", status: "resolved" }),
      session({ id: "ses_diff", type: "diff", createdAt: "2026-04-01T00:00:00.000Z" }),
      session({ id: "ses_plan", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(resolveOpenTarget(sessions, { match: isPlan })).toEqual({ kind: "session", sessionId: "ses_plan" });
  });

  test("no pending session in scope reports no-pending", () => {
    const sessions = [session({ id: "ses_done", status: "resolved" })];
    expect(resolveOpenTarget(sessions, { match: isPlan })).toEqual({ kind: "no-pending" });
  });
});

describe("resolveOpenTarget: by id", () => {
  test("an exact session id in scope opens that session, pending or not", () => {
    const sessions = [
      session({ id: "ses_a" }),
      session({ id: "ses_b", status: "resolved" }),
    ];
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "ses_b" })).toEqual({
      kind: "session",
      sessionId: "ses_b",
    });
  });

  test("an id outside the scope does not match", () => {
    const sessions = [session({ id: "ses_diff", type: "diff" })];
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "ses_diff" })).toEqual({
      kind: "no-match",
      selector: "ses_diff",
    });
  });
});

describe("resolveOpenTarget: fuzzy by title", () => {
  test("case-insensitive exact title wins over substring rivals", () => {
    const sessions = [
      session({ id: "ses_exact", title: "Rollout" }),
      session({ id: "ses_sub", title: "Rollout plan v2" }),
    ];
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "rollout" })).toEqual({
      kind: "session",
      sessionId: "ses_exact",
    });
  });

  test("a unique case-insensitive substring match wins", () => {
    const sessions = [
      session({ id: "ses_auth", title: "Auth rewrite" }),
      session({ id: "ses_cache", title: "Cache warmup" }),
    ];
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "AUTH" })).toEqual({
      kind: "session",
      sessionId: "ses_auth",
    });
  });

  test("several substring matches are ambiguous and list the candidate titles", () => {
    const sessions = [
      session({ id: "ses_1", title: "Payments rollout" }),
      session({ id: "ses_2", title: "Rollout of search" }),
    ];
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "rollout" })).toEqual({
      kind: "ambiguous",
      selector: "rollout",
      titles: ["Payments rollout", "Rollout of search"],
    });
  });

  test("no title match reports no-match", () => {
    const sessions = [session({ id: "ses_1", title: "Auth rewrite" })];
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "billing" })).toEqual({
      kind: "no-match",
      selector: "billing",
    });
  });
});

describe("openTargetMessage", () => {
  test("no-pending mirrors the clean-tree tone", () => {
    expect(openTargetMessage("plan", { kind: "no-pending" })).toBe("no pending plan review - nothing to open");
  });

  test("no-match names the selector", () => {
    expect(openTargetMessage("diff", { kind: "no-match", selector: "billing" })).toBe(
      'no diff review matches "billing" - nothing to open',
    );
  });

  test("ambiguous lists the candidate titles", () => {
    const message = openTargetMessage("plan", { kind: "ambiguous", selector: "rollout", titles: ["A", "B"] });
    expect(message).toContain('"rollout" matches several plan reviews');
    expect(message).toContain("  - A");
    expect(message).toContain("  - B");
  });
});
