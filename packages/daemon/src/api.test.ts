import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore, verdictResponse } from "./api";
import { SessionStore } from "./store";
import type { Artifact, WorkspaceKey } from "@cueloop/schema";

const WS: WorkspaceKey = { repoRoot: "/repo", branch: "main" };
const PLAN: Artifact = {
  type: "plan",
  content: "# Plan\n\n## Context\n\nDo the thing carefully.\n",
  meta: { agent: "test-agent", planPath: "plan.md" },
};

let home: string;
let core: DaemonCore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-test-"));
  core = new DaemonCore(home);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("session lifecycle", () => {
  test("create → get → list", () => {
    // Act
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Assert
    expect(session.status).toBe("pending");
    expect(session.revisions.length).toBe(1);
    expect(core.sessionGet(session.id).id).toBe(session.id);
    expect(core.sessionList({ status: "pending" }).length).toBe(1);
  });

  test("annotate upserts by id; remove deletes", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    core.sessionAnnotate(session.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
      body: "How carefully?",
    });
    core.sessionAnnotate(session.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
      body: "Define carefully.",
    });

    // Assert
    expect(core.sessionGet(session.id).annotations.length).toBe(1);
    expect(core.sessionGet(session.id).annotations[0]!.body).toBe("Define carefully.");

    // Act
    core.sessionRemoveAnnotation(session.id, "a1");

    // Assert
    expect(core.sessionGet(session.id).annotations.length).toBe(0);
  });

  test("resolve produces feedback.md and maps to the agent contract", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionAnnotate(session.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
      body: "Spell out the steps.",
    });

    // Act
    const resolved = core.sessionResolve(session.id, "request_changes", "Needs detail.");

    // Assert
    expect(resolved.verdict!.feedback).toContain("# Review: request changes");
    expect(resolved.verdict!.feedback).toContain("> carefully");
    expect(verdictResponse(resolved)).toEqual({ allow: false, feedback: resolved.verdict!.feedback });

    // Arrange
    const approved = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    core.sessionResolve(approved.id, "approve", "LGTM");

    // Assert
    expect(verdictResponse(core.sessionGet(approved.id)).allow).toBe(true);
  });

  test("mutating a resolved session throws", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionResolve(session.id, "approve", "");

    // Assert
    expect(() =>
      core.sessionAnnotate(session.id, { id: "a1", kind: "comment", anchor: { quote: "x", prefix: "", suffix: "" }, body: "b" }),
    ).toThrow("already resolved");
  });

  test("working copy stores edits and clears on revert or no-op", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    core.sessionSetWorkingCopy(session.id, PLAN.content.replace("carefully", "very carefully"));

    // Assert
    expect(core.sessionGet(session.id).workingCopy).toContain("very carefully");

    // Act
    core.sessionSetWorkingCopy(session.id, PLAN.content);

    // Assert
    expect(core.sessionGet(session.id).workingCopy).toBeUndefined();
  });

  test("viewed paths merge, dedupe, clear on empty, and survive a daemon restart", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    core.sessionSetViewed(session.id, ["src/a.ts", "src/b.ts", "src/a.ts"]);

    // Assert
    expect(core.sessionGet(session.id).viewedPaths).toEqual(["src/a.ts", "src/b.ts"]);

    // Act
    // merge-additive: a stale client sending only its own new mark loses nothing
    core.sessionSetViewed(session.id, ["src/c.ts"]);

    // Assert
    expect(core.sessionGet(session.id).viewedPaths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    // a resumed review reads its progress back after a daemon restart
    const reborn = new DaemonCore(home);
    expect(reborn.sessionGet(session.id).viewedPaths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);

    // Act
    core.sessionSetViewed(session.id, []);

    // Assert
    expect(core.sessionGet(session.id).viewedPaths).toBeUndefined();
  });

  test("revision reopens the session and resets working copy + verdict", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionSetWorkingCopy(session.id, PLAN.content + "\nedit");
    core.sessionResolve(session.id, "request_changes", "redo");

    // Act
    const revised = core.sessionSubmitRevision(session.id, "# Plan v2\n");

    // Assert
    expect(revised.status).toBe("pending");
    expect(revised.verdict).toBeNull();
    expect(revised.workingCopy).toBeUndefined();
    expect(revised.revisions.length).toBe(2);
    expect(revised.artifact.content).toBe("# Plan v2\n");
  });
});

describe("revision marks addressed annotations", () => {
  const annotate = (sessionId: string, id: string, quote: string, body = "note") =>
    core.sessionAnnotate(sessionId, { id, kind: "comment", anchor: { quote, prefix: "", suffix: "" }, body });

  test("ids the agent reports are marked addressed by that revision", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    annotate(session.id, "a1", "carefully");
    annotate(session.id, "a2", "Context");

    // Act: the revision keeps both quoted texts, so only the reported id resolves
    const revised = core.sessionSubmitRevision(session.id, PLAN.content + "\nMore.\n", ["a1"]);

    // Assert
    const [first, second] = revised.annotations;
    expect(first!.resolution).toEqual({ revision: 2, source: "agent" });
    expect(second!.resolution).toBeUndefined();
  });

  test("a plan annotation whose quoted text vanished is drift-addressed; a surviving quote stays open", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    annotate(session.id, "gone", "carefully");
    annotate(session.id, "kept", "Context");

    // Act: the revision rewrites the "carefully" sentence but keeps the Context heading
    const revised = core.sessionSubmitRevision(session.id, "# Plan\n\n## Context\n\nDo the thing with tests.\n");

    // Assert
    expect(revised.annotations.find((a) => a.id === "gone")!.resolution).toEqual({ revision: 2, source: "drift" });
    expect(revised.annotations.find((a) => a.id === "kept")!.resolution).toBeUndefined();
  });

  test("an unknown reported id is ignored, and an already-addressed annotation keeps its first resolution", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    annotate(session.id, "a1", "carefully");
    core.sessionSubmitRevision(session.id, PLAN.content, ["a1"]);

    // Act: a second revision reports a stale id and re-reports the settled one
    const revised = core.sessionSubmitRevision(session.id, PLAN.content, ["a1", "a_never_existed"]);

    // Assert
    expect(revised.annotations[0]!.resolution).toEqual({ revision: 2, source: "agent" });
    expect(revised.revisions.length).toBe(3);
  });

  test("a diff revision never drift-addresses - a new patch says nothing about the feedback", () => {
    // Arrange
    const diffArtifact: Artifact = { type: "diff", content: "+++ b/a.ts\n+new line\n", meta: {} };
    const session = core.sessionCreate({ workspace: WS, artifact: diffArtifact });
    annotate(session.id, "d1", "new line");

    // Act: the revised patch no longer contains the quoted text
    const revised = core.sessionSubmitRevision(session.id, "+++ b/b.ts\n+other\n");

    // Assert
    expect(revised.annotations[0]!.resolution).toBeUndefined();
  });

  test("the next feedback document omits addressed annotations and teaches the addressed-ids call", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    annotate(session.id, "settled", "carefully");
    annotate(session.id, "open", "Context", "needs a diagram");
    core.sessionSubmitRevision(session.id, PLAN.content, ["settled"]);

    // Act
    const resolved = core.sessionResolve(session.id, "request_changes", "one left");

    // Assert
    expect(resolved.verdict!.feedback).not.toContain("settled");
    expect(resolved.verdict!.feedback).toContain("annotation id: `open`");
    expect(resolved.verdict!.feedback).toContain(`submit-revision ${session.id}`);
    expect(resolved.verdict!.feedback).toContain("--addressed");
  });
});

describe("the wait contract: verdicts outlive waits", () => {
  test("wait resolves when the verdict arrives", async () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const wait = core.sessionWait(session.id, 5_000);

    // Act
    core.sessionResolve(session.id, "approve", "");
    const resolved = await wait;

    // Assert
    expect(resolved!.verdict!.kind).toBe("approve");
  });

  test("wait times out to null; a later wait collects the stored verdict", async () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    const first = await core.sessionWait(session.id, 30);

    // Assert
    expect(first).toBeNull();

    // Act
    core.sessionResolve(session.id, "request_changes", "later");
    const second = await core.sessionWait(session.id, 30);

    // Assert
    expect(second!.verdict!.summary).toBe("later");
  });

  test("multiple waiters all resolve", async () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const waits = [core.sessionWait(session.id, 5_000), core.sessionWait(session.id, 5_000)];

    // Act
    core.sessionResolve(session.id, "approve", "");
    const results = await Promise.all(waits);

    // Assert
    expect(results.every((result) => result?.status === "resolved")).toBe(true);
  });
});

describe("persistence and recovery", () => {
  test("sessions survive a daemon restart", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionResolve(session.id, "approve", "done");

    // Act
    const reborn = new DaemonCore(home);
    const recovered = reborn.sessionGet(session.id);

    // Assert
    expect(recovered.verdict!.summary).toBe("done");
  });

  test("corrupt records are skipped, not fatal, and never deleted", async () => {
    // Arrange
    core.sessionCreate({ workspace: WS, artifact: PLAN });
    await Bun.write(join(home, "sessions", "broken.json"), "{ not json");
    const store = new SessionStore(home);

    // Act
    const report = store.recover();

    // Assert
    expect(report.recovered.length).toBe(1);
    expect(report.skipped.length).toBe(1);
    expect(await Bun.file(join(home, "sessions", "broken.json")).exists()).toBe(true);
  });
});

describe("events", () => {
  test("lifecycle events fire in order", () => {
    // Arrange
    const seen: string[] = [];
    core.onEvent((event) => seen.push(event.event));

    // Act
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionAnnotate(session.id, { id: "a1", kind: "comment", anchor: { quote: "thing", prefix: "", suffix: "" }, body: "b" });
    core.sessionResolve(session.id, "approve", "");

    // Assert
    expect(seen).toEqual(["session.created", "inbox.changed", "session.updated", "session.resolved", "inbox.changed"]);
  });
});
