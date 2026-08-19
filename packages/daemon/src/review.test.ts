/** The shared review core against a real DaemonServer in a temp home: workspace resolution, title derivation, open-or-revise by agentSessionId, and both awaitVerdict shapes (one long-poll and the chunked loop with progress and abort). */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession } from "@cueloop/schema";
import { DaemonServer } from "./server";
import { DaemonClient } from "./client";
import { openReview, resolveWorkspace } from "./review";

const PLAN = "# Rollout Plan\n\nShip it in two stages.\n";

let home: string;
let server: DaemonServer;
let client: DaemonClient;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-review-core-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
});
afterEach(() => {
  client.close();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

function sh(args: string[], cwd: string): void {
  const gitResult = Bun.spawnSync(args, { cwd, stdout: "ignore", stderr: "ignore" });
  if (gitResult.exitCode !== 0) throw new Error(`${args.join(" ")} failed`);
}

describe("resolveWorkspace", () => {
  test("a git repo resolves to its root and branch", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cueloop-ws-"));
    try {
      // Arrange
      sh(["git", "init", "-q", "-b", "main"], repo);
      sh(["git", "config", "user.email", "t@t"], repo);
      sh(["git", "config", "user.name", "t"], repo);
      sh(["git", "commit", "-q", "--allow-empty", "-m", "init"], repo);

      // Act
      const ws = await resolveWorkspace(repo);

      // Assert
      expect(ws.branch).toBe("main");
      // macOS tmpdirs can resolve through /private; compare the tail
      expect(ws.repoRoot.endsWith(repo.split("/").at(-1)!)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("outside a repo the cwd itself is the workspace, branch detached", async () => {
    // Act
    const ws = await resolveWorkspace(home);

    // Assert
    expect(ws).toEqual({ repoRoot: home, branch: "detached" });
  });
});

describe("openReview", () => {
  test("shapes the artifact: agent, derived title, cwd", async () => {
    // Act
    const review = await openReview(client, {
      type: "plan",
      content: PLAN,
      cwd: home,
      agent: "test-agent",
    });

    // Assert
    const session = review.session;
    expect(session.status).toBe("pending");
    expect(session.artifact.type).toBe("plan");
    expect(session.artifact.meta.agent).toBe("test-agent");
    expect(session.artifact.meta.title).toBe("Rollout Plan");
    expect(session.artifact.meta.cwd).toBe(home);
    expect(session.workspace).toEqual({ repoRoot: home, branch: "detached" });
  });

  test("an explicit title wins; diffs never derive one from content", async () => {
    // Act
    const titled = await openReview(client, {
      type: "plan",
      content: PLAN,
      cwd: home,
      title: "Custom",
    });

    // Assert
    expect(titled.session.artifact.meta.title).toBe("Custom");

    // Act
    const diff = await openReview(client, {
      type: "diff",
      content: "# not a heading\n",
      cwd: home,
    });

    // Assert
    expect(diff.session.artifact.meta.title).toBeUndefined();
  });

  test("a pre-resolved workspace skips git resolution", async () => {
    // Arrange
    const ws = { repoRoot: "/elsewhere", branch: "feature" };

    // Act
    const review = await openReview(client, {
      type: "diff",
      content: "d",
      cwd: home,
      workspace: ws,
    });

    // Assert
    expect(review.session.workspace).toEqual(ws);
  });

  test("the same agentSessionId revises instead of opening a new session", async () => {
    // Arrange
    const first = await openReview(client, {
      type: "plan",
      content: PLAN,
      cwd: home,
      agentSessionId: "agent-1",
    });

    // Act
    const second = await openReview(client, {
      type: "plan",
      content: PLAN + "\nStage three.\n",
      cwd: home,
      agentSessionId: "agent-1",
    });

    // Assert
    expect(second.id).toBe(first.id);
    expect(second.session.revisions.length).toBe(2);
    expect(second.session.status).toBe("pending");

    // Act
    const other = await openReview(client, {
      type: "plan",
      content: PLAN,
      cwd: home,
      agentSessionId: "agent-2",
    });

    // Assert
    expect(other.id).not.toBe(first.id);
  });

  test("per-file notes land as note annotations anchored at the file path", async () => {
    // Act
    const review = await openReview(client, {
      type: "diff",
      content: "d",
      cwd: home,
      notes: [
        { path: "src/a.ts", body: "Renames b and adds c." },
        { path: "src/b.ts", body: "Swaps the line." },
      ],
    });

    // Assert
    const notes = review.session.annotations;
    expect(notes.length).toBe(2);
    expect(notes.every((annotation) => annotation.kind === "note")).toBe(true);
    expect(notes.map((annotation) => annotation.anchor.quote)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(notes[0]!.body).toBe("Renames b and adds c.");
  });
});

describe("awaitVerdict: one long-poll (the hook shape)", () => {
  test("times out to pending; a later wait collects the stored verdict", async () => {
    // Arrange
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });

    // Assert
    expect(await review.awaitVerdict({ timeoutMs: 50 })).toBe("pending");

    // Act
    await client.sessionResolve(review.id, "approve", "Fine.");
    const verdict = await review.awaitVerdict({ timeoutMs: 1_000 });

    // Assert
    expect(verdict).not.toBe("pending");
    if (verdict === "pending") throw new Error("unreachable");
    expect(verdict.allow).toBe(true);
    expect(verdict.feedback).toContain("Fine.");
    expect(verdict.session.verdict!.kind).toBe("approve");
  });

  test("request_changes maps to allow=false with feedback.md attached", async () => {
    // Arrange
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    const waiting = review.awaitVerdict({ timeoutMs: 5_000 });

    // Act
    await client.sessionResolve(review.id, "request_changes", "One stage only.");
    const verdict = await waiting;

    // Assert
    if (verdict === "pending") throw new Error("expected a verdict");
    expect(verdict.allow).toBe(false);
    expect(verdict.feedback).toContain("# Review: request changes");
    expect(verdict.feedback).toContain("One stage only.");
  });
});

describe("awaitVerdict: chunked loop (the pi shape)", () => {
  test("onProgress sees fresh sessions between chunks; the verdict ends the loop", async () => {
    // Arrange
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    const seen: ReviewSession[] = [];
    const waiting = review.awaitVerdict({
      timeoutMs: Infinity,
      pollMs: 100,
      onProgress: (progress) => seen.push(progress),
    });

    // Act
    await client.sessionAnnotate(review.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "two stages", prefix: "in ", suffix: "." },
      body: "Name them.",
    });

    // Assert
    // give the loop a chunk to observe the annotation before resolving
    for (let i = 0; i < 100 && !seen.some((snapshot) => snapshot.annotations.length === 1); i++)
      await Bun.sleep(20);
    expect(seen.some((snapshot) => snapshot.annotations.length === 1)).toBe(true);

    // Act
    await client.sessionResolve(review.id, "request_changes", "Too vague.");
    const verdict = await waiting;

    // Assert
    if (verdict === "pending") throw new Error("expected a verdict");
    expect(verdict.allow).toBe(false);
    expect(verdict.session.annotations.length).toBe(1);
  }, 15_000);

  test("abort surfaces as pending and leaves the session collectable", async () => {
    // Arrange
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    const controller = new AbortController();
    const waiting = review.awaitVerdict({
      timeoutMs: Infinity,
      pollMs: 100,
      signal: controller.signal,
    });

    // Act
    controller.abort();

    // Assert
    expect(await waiting).toBe("pending");
    expect((await client.sessionGet(review.id)).status).toBe("pending");
  });

  test("a finite budget runs out to pending", async () => {
    // Arrange
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });

    // Assert
    expect(await review.awaitVerdict({ timeoutMs: 120, pollMs: 50 })).toBe("pending");
  });
});
