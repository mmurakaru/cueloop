/**
 * The controller's tree primitives over a fake client: a move shows its path
 * before the daemon answers, refusals surface as status, a fork opens the fork,
 * and fork-and-share shares the fork while the current session stays put.
 */

import { describe, expect, mock, test } from "bun:test";
import {
  appendEntry,
  createBranch,
  historyFromLinear,
  SCHEMA_VERSION,
  switchBranch,
  type Annotation,
  type ReviewSession,
} from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { createReviewController, type ShareTransport } from "./session-controller";
import { mergeFromShare } from "./share";

const AT = "2026-01-01T00:00:00.000Z";

function annotation(id: string, body: string): Annotation {
  return {
    id,
    kind: "comment",
    anchor: { quote: "Plan", prefix: "", suffix: "" },
    body,
    createdAt: AT,
  };
}

/** A plan with one comment on main and its history. */
function sessionFixture(): ReviewSession {
  const session: ReviewSession = {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n", meta: {} },
    revisions: [{ revision: 1, content: "# Plan\n", submittedAt: AT }],
    annotations: [annotation("a1", "first")],
    verdict: null,
    status: "pending",
    createdAt: AT,
  };

  session.history = historyFromLinear(session);

  return session;
}

const publish = mock(async (session: ReviewSession) => ({
  line: `ssh p_${session.id}@cueloop.dev`,
  copied: true,
}));
const shareTransport: ShareTransport = {
  publish,
  pull: mock(async () => sessionFixture()),
  push: mock(async () => {}),
  watch: () => () => {},
  parseShareId: (line) => line.match(/^ssh (\S+)@/)?.[1],
  collaboratorAnnotations: (session) => session.annotations.filter((entry) => entry.author),
  mergeFromShare,
};

const unimplemented = (member: string) => () =>
  Promise.reject(new Error(`fakeClient does not implement ${member}`));

/** Tree requests never resolve here: what the controller shows is its own guess. */
const pending = () => new Promise<ReviewSession>(() => {});

function fakeClient(session: ReviewSession) {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionAnnotate: unimplemented("sessionAnnotate"),
    sessionRemoveAnnotation: unimplemented("sessionRemoveAnnotation"),
    sessionSetWorkingCopy: unimplemented("sessionSetWorkingCopy"),
    sessionCutBlock: unimplemented("sessionCutBlock"),
    sessionRestoreBlock: unimplemented("sessionRestoreBlock"),
    sessionCurate: unimplemented("sessionCurate"),
    sessionNavigate: mock(pending),
    sessionBranch: mock(pending),
    sessionSwitch: mock(pending),
    sessionLabel: mock(pending),
    sessionFork: mock(async (id: string) => ({
      ...sessionFixture(),
      id: `${id}_fork`,
      parentSessionId: id,
    })),
    sessionSetViewed: unimplemented("sessionSetViewed"),
    sessionSetShareId: mock(async (_id: string, _shareId: string) => session),
    sessionMergeShared: unimplemented("sessionMergeShared"),
    sessionDelete: unimplemented("sessionDelete"),
    sessionSetSelfName: unimplemented("sessionSetSelfName"),
    sessionResolve: unimplemented("sessionResolve"),
    close: () => {},
  } satisfies SessionClient;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connected(session = sessionFixture()) {
  const client = fakeClient(session);
  const controller = createReviewController({
    sessionId: session.id,
    openClient: async () => client,
    shareTransport,
  });

  controller.connect();
  await tick();

  return { controller, client, session };
}

describe("tree primitives", () => {
  test("a move back shows the earlier path at once and asks the daemon for the same move", async () => {
    // Arrange
    const { controller, client, session } = await connected();
    const revision = session.history!.entries[0]!.id;

    // Act
    controller.goToEntry(revision, "too soon");

    // Assert: the comment is off the shown path before any answer; the summary travels
    expect(controller.getSnapshot().session!.annotations).toEqual([]);
    expect(controller.getSnapshot().session!.shelvedAnnotations?.map((entry) => entry.id)).toEqual([
      "a1",
    ]);
    expect(controller.treeRows().find((row) => row.glyph === "↩")?.isCurrentTip).toBe(true);
    expect(client.sessionNavigate).toHaveBeenCalledWith("ses_1", revision, "too soon", undefined);
  });

  test("a move on another branch is one request that names the branch", async () => {
    // Arrange: alt with its own comment entry; the owner stands on main
    const session = sessionFixture();
    let history = createBranch(session.history!, "alt");

    history = appendEntry(history, { type: "comment", annotationId: "b1", createdAt: AT }).history;
    history = appendEntry(history, { type: "comment", annotationId: "b2", createdAt: AT }).history;
    session.history = switchBranch(history, "main");
    session.shelvedAnnotations = [annotation("b1", "alt one"), annotation("b2", "alt two")];
    const { controller, client } = await connected(session);
    const altFirst = history.entries.find(
      (entry) => entry.type === "comment" && entry.annotationId === "b1",
    )!;

    // Act
    controller.goToEntry(altFirst.id);

    // Assert
    expect(client.sessionSwitch).not.toHaveBeenCalled();
    expect(client.sessionNavigate).toHaveBeenCalledWith("ses_1", altFirst.id, undefined, "alt");
    expect(controller.getSnapshot().session!.annotations.map((entry) => entry.id)).toEqual([
      "a1",
      "b1",
    ]);
  });

  test("a refused move gives way to the daemon's record", async () => {
    // Arrange: the daemon refuses; a re-read hands back the untouched record
    const session = sessionFixture();
    const { controller, client } = await connected(session);

    client.sessionNavigate.mockImplementationOnce(() => Promise.reject(new Error("resolved")));

    // Act
    controller.goToEntry(session.history!.entries[0]!.id);
    const guessed = controller.getSnapshot().session!.annotations.length;

    await tick();

    // Assert: the guess showed, then the record came back
    expect(guessed).toBe(0);
    expect(controller.getSnapshot().session!.annotations.map((entry) => entry.id)).toEqual(["a1"]);
    expect(controller.getSnapshot().status).toBe("resolved");
  });

  test("branch and label refuse an empty name and a taken branch name", async () => {
    // Arrange
    const { controller, client } = await connected();

    // Act
    controller.branch("  ");
    controller.branch("main");
    controller.labelTip("");

    // Assert
    expect(client.sessionBranch).not.toHaveBeenCalled();
    expect(client.sessionLabel).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("a checkpoint needs a name");
  });

  test("a branch shows up on the tip and becomes the current branch", async () => {
    // Arrange
    const { controller, client } = await connected();

    // Act
    controller.branch("alt");

    // Assert
    expect(controller.getSnapshot().session!.history!.branch).toBe("alt");
    expect(controller.treeRows().find((row) => row.isCurrentTip)?.tips).toEqual(["main", "alt"]);
    expect(client.sessionBranch).toHaveBeenCalledWith("ses_1", "alt");
  });

  test("fork opens the fork; fork-and-share shares the fork and stays on the original", async () => {
    // Arrange
    const forked = await connected();
    const shared = await connected();

    // Act
    forked.controller.fork();
    shared.controller.forkAndShare();
    await tick();
    await tick();

    // Assert
    expect(forked.controller.getSnapshot().session!.id).toBe("ses_1_fork");
    expect(shared.controller.getSnapshot().session!.id).toBe("ses_1");
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: "ses_1_fork" }));
    expect(shared.client.sessionSetShareId).toHaveBeenCalledWith("ses_1_fork", "p_ses_1_fork");
    expect(shared.controller.getSnapshot().toast?.title).toBe("fork shared - link copied");
  });
});
