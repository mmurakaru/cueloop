import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore, verdictResponse } from "./api";
import { SessionStore } from "./store";
import { derivePath, tipOf, type Artifact, type WorkspaceKey } from "@cueloop/schema";
import { MAX_BLOB_BYTES, packSessionBlob, unpackSessionBlob } from "./share-blob";

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

  test("annotate with an author registers them in the participant registry", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    core.sessionAnnotate(
      session.id,
      {
        id: "a1",
        kind: "comment",
        anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
        body: "A collaborator's note.",
        author: "SHA256:ana",
      },
      "Ana",
    );

    // Assert
    const stored = core.sessionGet(session.id);

    expect(stored.annotations[0]!.author).toBe("SHA256:ana");
    expect(stored.participants).toEqual([{ id: "SHA256:ana", provider: "ssh", name: "Ana" }]);
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
    expect(verdictResponse(resolved)).toEqual({
      allow: false,
      feedback: resolved.verdict!.feedback,
    });

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
      core.sessionAnnotate(session.id, {
        id: "a1",
        kind: "comment",
        anchor: { quote: "x", prefix: "", suffix: "" },
        body: "b",
      }),
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
    core.sessionAnnotate(sessionId, {
      id,
      kind: "comment",
      anchor: { quote, prefix: "", suffix: "" },
      body,
    });

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

  test("a reported root comment addresses its replies as well", () => {
    // Arrange: a discussion of a root and one reply, plus an unrelated comment
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    annotate(session.id, "root", "carefully");
    core.sessionAnnotate(session.id, {
      id: "reply",
      kind: "comment",
      anchor: { quote: "carefully", prefix: "", suffix: "" },
      body: "agreed",
      replyTo: "root",
    });
    annotate(session.id, "other", "Context");

    // Act: the agent reports only the root
    const revised = core.sessionSubmitRevision(session.id, PLAN.content + "\nMore.\n", ["root"]);
    const byId = new Map(revised.annotations.map((annotation) => [annotation.id, annotation]));

    // Assert
    expect(byId.get("root")!.resolution).toEqual({ revision: 2, source: "agent" });
    expect(byId.get("reply")!.resolution).toEqual({ revision: 2, source: "agent" });
    expect(byId.get("other")!.resolution).toBeUndefined();
  });

  test("a plan annotation whose quoted text vanished is drift-addressed; a surviving quote stays open", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });

    annotate(session.id, "gone", "carefully");
    annotate(session.id, "kept", "Context");

    // Act: the revision rewrites the "carefully" sentence but keeps the Context heading
    const revised = core.sessionSubmitRevision(
      session.id,
      "# Plan\n\n## Context\n\nDo the thing with tests.\n",
    );

    // Assert
    expect(revised.annotations.find((a) => a.id === "gone")!.resolution).toEqual({
      revision: 2,
      source: "drift",
    });
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

    core.sessionAnnotate(session.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "thing", prefix: "", suffix: "" },
      body: "b",
    });
    core.sessionResolve(session.id, "approve", "");

    // Assert
    expect(seen).toEqual([
      "session.created",
      "inbox.changed",
      "session.updated",
      "session.resolved",
      "inbox.changed",
    ]);
  });
});

describe("the session history records every write as an entry", () => {
  const annotate = (sessionId: string, id: string, quote: string, body = "note") =>
    core.sessionAnnotate(sessionId, {
      id,
      kind: "comment",
      anchor: { quote, prefix: "", suffix: "" },
      body,
    });

  test("create, comment, remove, resolve, and revise append in order on main", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Assert: a fresh session is one root revision
    expect(created.history?.entries.map((entry) => entry.type)).toEqual(["revision"]);
    expect(created.history?.tips.main).toBe(created.history?.entries[0]!.id);

    // Act
    annotate(created.id, "a1", "carefully");
    annotate(created.id, "a1", "carefully", "edited body");
    annotate(created.id, "a2", "Context");
    core.sessionRemoveAnnotation(created.id, "a2");
    core.sessionRemoveAnnotation(created.id, "never-existed");
    core.sessionResolve(created.id, "request_changes", "tighten");
    const revised = core.sessionSubmitRevision(created.id, PLAN.content + "\nMore.\n", ["a1"]);

    // Assert: an edit of an existing comment and a removal of an unknown id leave no entry
    const history = revised.history!;

    expect(history.entries.map((entry) => entry.type)).toEqual([
      "revision",
      "comment",
      "comment",
      "comment-removed",
      "verdict",
      "revision",
    ]);
    expect(history.branch).toBe("main");
    expect(history.tips.main).toBe(history.entries.at(-1)!.id);
    // every entry chains on the one before
    history.entries.forEach((entry, index) => {
      expect(entry.parentId).toBe(index === 0 ? null : history.entries[index - 1]!.id);
    });
  });

  test("the head of the current path is the artifact, and the open comments are the path's", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    annotate(created.id, "a1", "carefully");
    annotate(created.id, "a2", "Context");
    core.sessionRemoveAnnotation(created.id, "a1");
    const revised = core.sessionSubmitRevision(created.id, "# Plan v2\n");

    // Act
    const derived = derivePath(revised.history!);

    // Assert
    expect(derived.head.content).toBe(revised.artifact.content);
    expect(derived.annotationIds).toEqual(["a2"]);
    expect(derived.rounds).toBe(2);
  });

  test("a shared session's incoming comments become entries, and the blob round-trips with its history", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    const merged = core.sessionMergeShared(created.id, {
      annotations: [
        {
          id: "ana_1",
          kind: "comment",
          anchor: { quote: "Context", prefix: "", suffix: "" },
          body: "from ana",
          author: "SHA256:ana",
          createdAt: "2026-09-01T10:00:00.000Z",
        },
      ],
    });
    const roundTripped = unpackSessionBlob(packSessionBlob(merged));

    // Assert
    expect(merged.history?.entries.at(-1)).toMatchObject({
      type: "comment",
      annotationId: "ana_1",
    });
    expect(roundTripped.history).toEqual(merged.history);
    expect(packSessionBlob(merged).byteLength).toBeLessThan(MAX_BLOB_BYTES);
  });

  test("a session written before histories existed gets one on the next boot", () => {
    // Arrange: a record with no history on disk, as an earlier daemon left it
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const legacy = { ...created };

    delete legacy.history;
    new SessionStore(home).upsert(legacy);

    // Act
    const rebooted = new DaemonCore(home);
    const recovered = rebooted.sessionGet(created.id);

    // Assert
    expect(recovered.history?.entries.map((entry) => entry.type)).toEqual(["revision"]);
    expect(derivePath(recovered.history!).head.content).toBe(PLAN.content);
  });
});

describe("curation primitives", () => {
  test("cutting a block records a reviewer revision; restoring it returns the copy to pristine", () => {
    // Arrange: block 2 of the plan is the paragraph
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Act
    const cut = core.sessionCutBlock(created.id, 2);

    // Assert: the working copy lost the paragraph and the history gained the edit
    expect(cut.workingCopy).not.toContain("Do the thing carefully.");
    expect(cut.history!.entries.at(-1)).toMatchObject({ type: "revision", by: "reviewer" });
    expect(derivePath(cut.history!).head.content).toBe(cut.workingCopy!);

    // Act: put it back where it was (block 2 of the submitted revision, before the end)
    const restored = core.sessionRestoreBlock(created.id, 2);

    // Assert: pristine again, and that edit is on record too
    expect(restored.workingCopy).toBeUndefined();
    expect(derivePath(restored.history!).head.content).toBe(PLAN.content);
    expect(restored.history!.entries.filter((entry) => entry.type === "revision")).toHaveLength(3);
  });

  test("a block index outside the text is refused", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Assert
    expect(() => core.sessionCutBlock(created.id, 99)).toThrow(/no block 99/);
    expect(() => core.sessionRestoreBlock(created.id, 99)).toThrow(/no block 99/);
  });

  test("restoring a block that is present is refused rather than duplicated", () => {
    // Arrange: nothing cut, then block 2 cut once
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Assert: a pristine copy has every block
    expect(() => core.sessionRestoreBlock(created.id, 2)).toThrow(/present in the working copy/);

    // Act
    core.sessionCutBlock(created.id, 2);
    const restored = core.sessionRestoreBlock(created.id, 2);

    // Assert: one restore puts it back; a second would duplicate it
    expect(restored.workingCopy).toBeUndefined();
    expect(() => core.sessionRestoreBlock(created.id, 2)).toThrow(/present in the working copy/);
  });

  test("curating a diff stores the decisions and the patch they leave; no decisions clear both", () => {
    // Arrange: one file with two separated changes
    const oldContents = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    const newContents = "a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\n";
    const diff: Artifact = {
      type: "diff",
      content: "",
      meta: {},
      files: [{ path: "src/x.txt", oldContents, newContents, status: "modified" }],
    };
    const created = core.sessionCreate({ workspace: WS, artifact: diff });

    // Act: reject the first hunk
    const curated = core.sessionCurate(created.id, [{ path: "src/x.txt", hunkIndex: 0 }]);

    // Assert: only the second change survives in the working copy
    expect(curated.curation).toEqual([{ path: "src/x.txt", hunkIndex: 0 }]);
    expect(curated.workingCopy).toContain("+J");
    expect(curated.workingCopy).not.toContain("+B");
    expect(curated.history!.entries.at(-1)).toMatchObject({ type: "revision", by: "reviewer" });

    // Act
    const cleared = core.sessionCurate(created.id, []);

    // Assert
    expect(cleared.curation).toBeUndefined();
    expect(cleared.workingCopy).toBeUndefined();
  });

  test("a plan cannot be curated by hunk", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    // Assert
    expect(() => core.sessionCurate(created.id, [])).toThrow(/only a diff review/);
  });
});

describe("tree primitives", () => {
  const comment = (id: string, body: string) => ({
    id,
    kind: "comment" as const,
    anchor: { quote: "carefully", prefix: "the thing ", suffix: "." },
    body,
  });

  test("navigating main back hides later comments and edits, and the agent's next revision lands there", () => {
    // Arrange: comment, reviewer edit, second comment
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    core.sessionAnnotate(created.id, comment("a1", "first"));
    const checkpoint = derivePath(core.sessionGet(created.id).history!);
    const checkpointEntry = tipOf(core.sessionGet(created.id).history!);

    core.sessionLabel(created.id, "after a1");
    core.sessionSetWorkingCopy(created.id, "# Plan\n\n## Context\n\nDo it.\n");
    core.sessionAnnotate(created.id, comment("a2", "second"));

    // Act
    const moved = core.sessionNavigate(created.id, checkpointEntry, "dropped the edit");

    // Assert: the view is the checkpoint's, the abandoned segment is on record
    expect(moved.workingCopy).toBeUndefined();
    expect(moved.annotations.map((annotation) => annotation.id)).toEqual(["a1"]);
    expect(moved.shelvedAnnotations!.map((annotation) => annotation.id)).toEqual(["a2"]);
    expect(moved.history!.labels[checkpointEntry]).toBe("after a1");
    expect(derivePath(moved.history!).summaries[0]!.abandoned).toHaveLength(2);
    expect(checkpoint.annotationIds).toEqual(["a1"]);

    // Act: the agent resubmits
    const revised = core.sessionSubmitRevision(created.id, "# Plan\n\nRevised.\n");

    // Assert: the revision chains after the summary on main
    const path = derivePath(revised.history!);

    expect(path.head.content).toBe("# Plan\n\nRevised.\n");
    expect(revised.history!.entries.at(-1)!.parentId).toBe(
      derivePath(moved.history!).summaries[0]!.id,
    );
  });

  test("the feedback document renders from the tip's path", () => {
    // Arrange: two comments, then main moved back between them
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    core.sessionAnnotate(created.id, comment("a1", "keep this one"));
    const between = tipOf(core.sessionGet(created.id).history!);

    core.sessionAnnotate(created.id, comment("a2", "not this one"));
    core.sessionNavigate(created.id, between);

    // Act
    const resolved = core.sessionResolve(created.id, "request_changes", "one note");

    // Assert
    expect(resolved.verdict!.feedback).toContain("keep this one");
    expect(resolved.verdict!.feedback).not.toContain("not this one");
  });

  test("a navigate to the tip or off the path is refused", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const tip = tipOf(created.history!);

    core.sessionBranch(created.id, "alt");
    core.sessionAnnotate(created.id, comment("a1", "on alt"));
    const onAlt = tipOf(core.sessionGet(created.id).history!, "alt");

    core.sessionSwitch(created.id, "main");

    // Assert
    expect(() => core.sessionNavigate(created.id, tip)).toThrow(/already at/);
    expect(() => core.sessionNavigate(created.id, onAlt)).toThrow(/not on branch "main"/);
    expect(() => core.sessionNavigate(created.id, "e_nope")).toThrow(/no entry/);
  });

  test("branching keeps main where it is; switching shows each branch's own comments", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    core.sessionAnnotate(created.id, comment("shared", "on both"));

    // Act
    core.sessionBranch(created.id, "alt");
    core.sessionAnnotate(created.id, comment("alt-only", "on alt"));
    const onAlt = core
      .sessionSwitch(created.id, "alt")
      .annotations.map((annotation) => annotation.id);
    const onMain = core.sessionSwitch(created.id, "main");

    // Assert
    expect(onAlt).toEqual(["shared", "alt-only"]);
    expect(onMain.annotations.map((annotation) => annotation.id)).toEqual(["shared"]);
    expect(onMain.shelvedAnnotations!.map((annotation) => annotation.id)).toEqual(["alt-only"]);
    expect(() => core.sessionBranch(created.id, "alt")).toThrow(/exists/);
    expect(() => core.sessionSwitch(created.id, "nope")).toThrow(/no branch/);
  });

  test("a removed comment is shelved, and a share merge does not bring it back", () => {
    // Arrange
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    core.sessionAnnotate(created.id, comment("a1", "first"));
    const removed = core.sessionRemoveAnnotation(created.id, "a1");

    // Act
    const merged = core.sessionMergeShared(created.id, {
      annotations: [{ ...comment("a1", "first"), createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    // Assert
    expect(removed.shelvedAnnotations!.map((annotation) => annotation.id)).toEqual(["a1"]);
    expect(merged.annotations).toEqual([]);
  });

  test("a fork is a new pending session on the copied path, without verdict, edits, or share", () => {
    // Arrange: comment, edit, resolve, then a second round
    const created = core.sessionCreate({ workspace: WS, artifact: PLAN });

    core.sessionAnnotate(created.id, comment("a1", "first"), "Ana");
    core.sessionSetShareId(created.id, "share-1");
    core.sessionResolve(created.id, "request_changes", "again");
    core.sessionSubmitRevision(created.id, "# Plan\n\nRound two.\n", ["a1"]);
    core.sessionLabel(created.id, "round two");
    core.sessionSetWorkingCopy(created.id, "# Plan\n\nRound two, edited.\n");

    // Act
    const fork = core.sessionFork(created.id);

    // Assert
    expect(fork.id).not.toBe(created.id);
    expect(fork.parentSessionId).toBe(created.id);
    expect(fork.status).toBe("pending");
    expect(fork.verdict).toBeNull();
    expect(fork.shareId).toBeUndefined();
    expect(fork.workingCopy).toBeUndefined();
    expect(fork.artifact.content).toBe("# Plan\n\nRound two.\n");
    expect(fork.revisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(fork.annotations.map((annotation) => annotation.id)).toEqual(["a1"]);
    expect(fork.participants).toEqual(
      created.participants ?? core.sessionGet(created.id).participants,
    );
    expect(Object.values(fork.history!.labels)).toEqual(["round two"]);
    expect(fork.history!.entries.map((entry) => entry.type)).toEqual([
      "revision",
      "comment",
      "revision",
    ]);
    expect(core.sessionList().map((session) => session.id)).toContain(fork.id);
  });
});
