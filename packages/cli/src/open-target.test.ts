/** Verb-first open resolution over a plain session list: latest-pending default, by-id, and fuzzy-by-title (exact wins, unique substring wins, else ambiguous). Pure over the array - no daemon, no TUI. */

import { describe, expect, test } from "bun:test";
import type { ArtifactType, ReviewSession } from "@cueloop/schema";
import {
  isDiffReview,
  isPlanReview,
  isPrReview,
  isSessionId,
  openTargetMessage,
  resolveOpenTarget,
} from "./open-target";

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

const isPlan = isPlanReview;

describe("verb scope predicates are disjoint", () => {
  test("isPlanReview matches only plan artifacts", () => {
    expect(isPlanReview(session({ id: "ses_p", type: "plan" }))).toBe(true);
    expect(isPlanReview(session({ id: "ses_d", type: "diff" }))).toBe(false);
  });

  test("isDiffReview matches a plain diff but NOT a diff carrying meta.pr", () => {
    expect(isDiffReview(session({ id: "ses_d", type: "diff" }))).toBe(true);
    expect(isDiffReview(session({ id: "ses_pr", type: "diff", pr: "42" }))).toBe(false);
    expect(isDiffReview(session({ id: "ses_p", type: "plan" }))).toBe(false);
  });

  test("isPrReview matches a diff carrying meta.pr, and only that", () => {
    expect(isPrReview(session({ id: "ses_pr", type: "diff", pr: "42" }))).toBe(true);
    expect(isPrReview(session({ id: "ses_d", type: "diff" }))).toBe(false);
    expect(isPrReview(session({ id: "ses_p", type: "plan" }))).toBe(false);
  });

  test("a PR review resolves under exactly one scope - never both diff and review", () => {
    // Arrange
    const prReview = session({ id: "ses_pr", type: "diff", pr: "42" });

    // Assert
    expect(isDiffReview(prReview)).toBe(false);
    expect(isPrReview(prReview)).toBe(true);
  });
});

describe("isSessionId", () => {
  test("only the ses_ prefix reads as an id", () => {
    expect(isSessionId("ses_abc")).toBe(true);
    expect(isSessionId("some title")).toBe(false);
    expect(isSessionId("42")).toBe(false);
  });
});

describe("resolveOpenTarget: latest pending default", () => {
  test("picks the most recent pending session in scope", () => {
    // Arrange
    const sessions = [
      session({ id: "ses_old", createdAt: "2026-01-01T00:00:00.000Z" }),
      session({ id: "ses_new", createdAt: "2026-03-01T00:00:00.000Z" }),
      session({ id: "ses_mid", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan })).toEqual({ kind: "session", sessionId: "ses_new" });
  });

  test("ignores resolved sessions and other artifact types", () => {
    // Arrange
    const sessions = [
      session({ id: "ses_resolved", createdAt: "2026-05-01T00:00:00.000Z", status: "resolved" }),
      session({ id: "ses_diff", type: "diff", createdAt: "2026-04-01T00:00:00.000Z" }),
      session({ id: "ses_plan", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan })).toEqual({ kind: "session", sessionId: "ses_plan" });
  });

  test("no pending session in scope reports no-pending", () => {
    // Arrange
    const sessions = [session({ id: "ses_done", status: "resolved" })];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan })).toEqual({ kind: "no-pending" });
  });
});

describe("resolveOpenTarget: by id", () => {
  test("an exact session id in scope opens that session, pending or not", () => {
    // Arrange
    const sessions = [
      session({ id: "ses_a" }),
      session({ id: "ses_b", status: "resolved" }),
    ];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "ses_b" })).toEqual({
      kind: "session",
      sessionId: "ses_b",
    });
  });

  test("an id outside the scope does not match", () => {
    // Arrange
    const sessions = [session({ id: "ses_diff", type: "diff" })];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "ses_diff" })).toEqual({
      kind: "no-match",
      selector: "ses_diff",
    });
  });
});

describe("resolveOpenTarget: fuzzy by title", () => {
  test("case-insensitive exact title wins over substring rivals", () => {
    // Arrange
    const sessions = [
      session({ id: "ses_exact", title: "Rollout" }),
      session({ id: "ses_sub", title: "Rollout plan v2" }),
    ];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "rollout" })).toEqual({
      kind: "session",
      sessionId: "ses_exact",
    });
  });

  test("a unique case-insensitive substring match wins", () => {
    // Arrange
    const sessions = [
      session({ id: "ses_auth", title: "Auth rewrite" }),
      session({ id: "ses_cache", title: "Cache warmup" }),
    ];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "AUTH" })).toEqual({
      kind: "session",
      sessionId: "ses_auth",
    });
  });

  test("several substring matches are ambiguous and list the candidate titles", () => {
    // Arrange
    const sessions = [
      session({ id: "ses_1", title: "Payments rollout" }),
      session({ id: "ses_2", title: "Rollout of search" }),
    ];

    // Assert
    expect(resolveOpenTarget(sessions, { match: isPlan, selector: "rollout" })).toEqual({
      kind: "ambiguous",
      selector: "rollout",
      titles: ["Payments rollout", "Rollout of search"],
    });
  });

  test("no title match reports no-match", () => {
    // Arrange
    const sessions = [session({ id: "ses_1", title: "Auth rewrite" })];

    // Assert
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
    // Act
    const message = openTargetMessage("plan", { kind: "ambiguous", selector: "rollout", titles: ["A", "B"] });

    // Assert
    expect(message).toContain('"rollout" matches several plan reviews');
    expect(message).toContain("  - A");
    expect(message).toContain("  - B");
  });
});
