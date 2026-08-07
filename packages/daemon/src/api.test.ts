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
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    expect(s.status).toBe("pending");
    expect(s.revisions.length).toBe(1);
    expect(core.sessionGet(s.id).id).toBe(s.id);
    expect(core.sessionList({ status: "pending" }).length).toBe(1);
  });

  test("annotate upserts by id; remove deletes", () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionAnnotate(s.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
      body: "How carefully?",
    });
    core.sessionAnnotate(s.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
      body: "Define carefully.",
    });
    expect(core.sessionGet(s.id).annotations.length).toBe(1);
    expect(core.sessionGet(s.id).annotations[0]!.body).toBe("Define carefully.");
    core.sessionRemoveAnnotation(s.id, "a1");
    expect(core.sessionGet(s.id).annotations.length).toBe(0);
  });

  test("resolve produces feedback.md and maps to the agent contract", () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionAnnotate(s.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
      body: "Spell out the steps.",
    });
    const resolved = core.sessionResolve(s.id, "request_changes", "Needs detail.");
    expect(resolved.verdict!.feedback).toContain("# Review: request changes");
    expect(resolved.verdict!.feedback).toContain("> carefully");
    expect(verdictResponse(resolved)).toEqual({ allow: false, feedback: resolved.verdict!.feedback });
    const approved = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionResolve(approved.id, "approve", "LGTM");
    expect(verdictResponse(core.sessionGet(approved.id)).allow).toBe(true);
  });

  test("mutating a resolved session throws", () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionResolve(s.id, "approve", "");
    expect(() =>
      core.sessionAnnotate(s.id, { id: "a1", kind: "comment", anchor: { quote: "x", prefix: "", suffix: "" }, body: "b" }),
    ).toThrow("already resolved");
  });

  test("working copy stores edits and clears on revert or no-op", () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionSetWorkingCopy(s.id, PLAN.content.replace("carefully", "very carefully"));
    expect(core.sessionGet(s.id).workingCopy).toContain("very carefully");
    core.sessionSetWorkingCopy(s.id, PLAN.content);
    expect(core.sessionGet(s.id).workingCopy).toBeUndefined();
  });

  test("revision reopens the session and resets working copy + verdict", () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionSetWorkingCopy(s.id, PLAN.content + "\nedit");
    core.sessionResolve(s.id, "request_changes", "redo");
    const revised = core.sessionSubmitRevision(s.id, "# Plan v2\n");
    expect(revised.status).toBe("pending");
    expect(revised.verdict).toBeNull();
    expect(revised.workingCopy).toBeUndefined();
    expect(revised.revisions.length).toBe(2);
    expect(revised.artifact.content).toBe("# Plan v2\n");
  });
});

describe("the wait contract: verdicts outlive waits", () => {
  test("wait resolves when the verdict arrives", async () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const wait = core.sessionWait(s.id, 5_000);
    core.sessionResolve(s.id, "approve", "");
    const resolved = await wait;
    expect(resolved!.verdict!.kind).toBe("approve");
  });

  test("wait times out to null; a later wait collects the stored verdict", async () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const first = await core.sessionWait(s.id, 30);
    expect(first).toBeNull();
    core.sessionResolve(s.id, "request_changes", "later");
    const second = await core.sessionWait(s.id, 30);
    expect(second!.verdict!.summary).toBe("later");
  });

  test("multiple waiters all resolve", async () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const waits = [core.sessionWait(s.id, 5_000), core.sessionWait(s.id, 5_000)];
    core.sessionResolve(s.id, "approve", "");
    const results = await Promise.all(waits);
    expect(results.every((r) => r?.status === "resolved")).toBe(true);
  });
});

describe("persistence and recovery", () => {
  test("sessions survive a daemon restart", () => {
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionResolve(s.id, "approve", "done");
    const reborn = new DaemonCore(home);
    const recovered = reborn.sessionGet(s.id);
    expect(recovered.verdict!.summary).toBe("done");
  });

  test("corrupt records are skipped, not fatal, and never deleted", async () => {
    core.sessionCreate({ workspace: WS, artifact: PLAN });
    await Bun.write(join(home, "sessions", "broken.json"), "{ not json");
    const store = new SessionStore(home);
    const report = store.recover();
    expect(report.recovered.length).toBe(1);
    expect(report.skipped.length).toBe(1);
    expect(await Bun.file(join(home, "sessions", "broken.json")).exists()).toBe(true);
  });
});

describe("events", () => {
  test("lifecycle events fire in order", () => {
    const seen: string[] = [];
    core.onEvent((e) => seen.push(e.event));
    const s = core.sessionCreate({ workspace: WS, artifact: PLAN });
    core.sessionAnnotate(s.id, { id: "a1", kind: "comment", anchor: { quote: "thing", prefix: "", suffix: "" }, body: "b" });
    core.sessionResolve(s.id, "approve", "");
    expect(seen).toEqual(["session.created", "inbox.changed", "session.updated", "session.resolved", "inbox.changed"]);
  });
});
