import { describe, expect, mock, test } from "bun:test";
import { ManualClock } from "@opentui/core/testing";
import { SCHEMA_VERSION, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { createReviewController, SHARE_POLL_MS, type ShareTransport } from "./session-controller";

const publishShare = mock(async () => ({ line: "ssh p_abc123xy@cueloop.dev", copied: true }));
let remote: ReviewSession;
const pullShare = mock(async () => remote);
const pushShare = mock(
  async (_shareId: string, _annotations: Array<Omit<Annotation, "createdAt">>) => {},
);

const shareTransport: ShareTransport = {
  publish: publishShare,
  pull: pullShare,
  push: pushShare,
  parseShareId: (line) => line.match(/^ssh (\S+)@/)?.[1],
  collaboratorAnnotations: (session) =>
    session.annotations.filter((entry) => entry.author),
};

function sessionFixture(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n", meta: {} },
    revisions: [{ revision: 1, content: "# Plan\n", submittedAt: "2026-01-01T00:00:00.000Z" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function annotation(id: string, author: string): Annotation {
  return {
    id,
    kind: "comment",
    anchor: { quote: "Plan", prefix: "", suffix: "" },
    body: "note",
    author,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function fakeClient(session: ReviewSession): SessionClient {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionAnnotate: mock(async () => session),
    sessionSetShareId: mock(
      async (_id: string, shareId: string) => ((session.shareId = shareId), session),
    ),
    sessionMergeShared: mock(async (_id: string, incoming: { annotations: Annotation[] }) => {
      const known = new Set(session.annotations.map((existing) => existing.id));

      for (const note of incoming.annotations)
        if (!known.has(note.id)) session.annotations.push(note);

      return session;
    }),
    close: () => {},
  } as unknown as SessionClient;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connectedController(
  session: ReviewSession,
  clock?: ManualClock,
): Promise<{ controller: ReturnType<typeof createReviewController>; client: SessionClient }> {
  const client = fakeClient(session);
  const controller = createReviewController({
    sessionId: session.id,
    openClient: async () => client,
    clock,
    shareTransport,
  });

  controller.connect();
  await tick();

  return { controller, client };
}

describe("share", () => {
  test("stamps the returned share id back on the session", async () => {
    // Arrange
    const { controller, client } = await connectedController(sessionFixture());

    // Act
    controller.share();
    await tick();

    // Assert
    expect(client.sessionSetShareId).toHaveBeenCalledWith("ses_1", "p_abc123xy");
  });

  test("surfaces the ssh line as a toast, not an inline status", async () => {
    // Arrange
    const { controller } = await connectedController(sessionFixture());

    // Act
    controller.share();
    await tick();

    // Assert
    expect(controller.getSnapshot().toast).toEqual({
      body: "ssh p_abc123xy@cueloop.dev",
      title: "share link copied",
    });
    expect(controller.getSnapshot().status).not.toContain("ssh p_abc123xy@cueloop.dev");
  });
});

describe("pullShared", () => {
  test("unions collaborator notes and identities in when the plan was shared", async () => {
    // Arrange
    remote = sessionFixture({
      annotations: [annotation("a1", "SHA256:mate")],
      participants: [{ id: "SHA256:mate", provider: "ssh", name: "Sam" }],
    });
    const { controller, client } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
    );

    // Act
    controller.pullShared();
    await tick();

    // Assert
    expect(pullShare).toHaveBeenCalledWith("p_abc123xy");
    expect(client.sessionMergeShared).toHaveBeenCalledWith("ses_1", {
      annotations: remote.annotations,
      participants: remote.participants,
    });
  });

  test("does nothing for a plan that was never shared", async () => {
    // Arrange
    pullShare.mockClear();
    const { controller, client } = await connectedController(sessionFixture());

    // Act
    controller.pullShared();
    await tick();

    // Assert
    expect(pullShare).not.toHaveBeenCalled();
    expect(client.sessionMergeShared).not.toHaveBeenCalled();
  });
});

describe("mirror on annotate", () => {
  test("pushes an edited note up when the plan is shared", async () => {
    // Arrange
    pushShare.mockClear();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy", annotations: [annotation("a1", "SHA256:me")] }),
    );

    // Act
    controller.updateAnnotation("a1", "revised body");
    await tick();

    // Assert
    expect(pushShare).toHaveBeenCalledTimes(1);
    expect(pushShare.mock.calls[0]?.[0]).toBe("p_abc123xy");
    expect(pushShare.mock.calls[0]?.[1]).toEqual([
      {
        id: "a1",
        kind: "comment",
        anchor: { quote: "Plan", prefix: "", suffix: "" },
        body: "revised body",
      },
    ]);
  });

  test("does not push when the plan was never shared", async () => {
    // Arrange
    pushShare.mockClear();
    const { controller } = await connectedController(
      sessionFixture({ annotations: [annotation("a1", "SHA256:me")] }),
    );

    // Act
    controller.updateAnnotation("a1", "revised body");
    await tick();

    // Assert
    expect(pushShare).not.toHaveBeenCalled();
  });

  test("does not push when the local write is rejected", async () => {
    // Arrange - the daemon write fails (e.g. a resolved session)
    pushShare.mockClear();
    const { controller, client } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy", annotations: [annotation("a1", "SHA256:me")] }),
    );

    (client.sessionAnnotate as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("session is resolved");
    });

    // Act
    controller.updateAnnotation("a1", "revised body");
    await tick();

    // Assert - a failed local write must never leak to the share
    expect(pushShare).not.toHaveBeenCalled();
  });
});

describe("startSharePoll", () => {
  test("pulls now and again each interval until stopped", async () => {
    // Arrange
    pullShare.mockClear();
    remote = sessionFixture({ annotations: [] });
    const clock = new ManualClock();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
    );

    // Act - immediate pull
    const stop = controller.startSharePoll();

    await tick();

    // Assert
    expect(pullShare).toHaveBeenCalledTimes(1);

    // Act - one interval later, it pulls again
    clock.advance(SHARE_POLL_MS);
    await tick();

    // Assert
    expect(pullShare).toHaveBeenCalledTimes(2);

    // Act - stop, then advance: no further pulls
    stop();
    clock.advance(SHARE_POLL_MS * 3);
    await tick();

    // Assert
    expect(pullShare).toHaveBeenCalledTimes(2);
  });

  test("a stop during an in-flight pull leaves no zombie timer", async () => {
    // Arrange - the first pull hangs until released
    pullShare.mockClear();
    remote = sessionFixture({ annotations: [] });
    let release: () => void = () => {};

    pullShare.mockImplementationOnce(
      () => new Promise<ReviewSession>((resolve) => (release = () => resolve(remote))),
    );
    const clock = new ManualClock();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
    );

    // Act - start (pull is in flight), leave, then let the pull settle
    const stop = controller.startSharePoll();

    await tick();
    expect(pullShare).toHaveBeenCalledTimes(1);
    stop();
    release();
    await tick();
    clock.advance(SHARE_POLL_MS * 3);
    await tick();

    // Assert - the settled pull's finally must not re-arm the timer
    expect(pullShare).toHaveBeenCalledTimes(1);
  });

  test("a restart during an in-flight pull does not double the poll", async () => {
    // Arrange - run A's first pull hangs; later pulls resolve immediately
    pullShare.mockClear();
    remote = sessionFixture({ annotations: [] });
    let release: () => void = () => {};

    pullShare.mockImplementationOnce(
      () => new Promise<ReviewSession>((resolve) => (release = () => resolve(remote))),
    );
    const clock = new ManualClock();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
    );

    // Act - run A starts (pull hangs), then run B restarts while A is in flight
    controller.startSharePoll();
    await tick();
    expect(pullShare).toHaveBeenCalledTimes(1);
    const stopB = controller.startSharePoll();

    await tick();
    expect(pullShare).toHaveBeenCalledTimes(2);

    // A's stale pull settles - it must not re-arm; then one interval fires only run B
    release();
    await tick();
    clock.advance(SHARE_POLL_MS);
    await tick();

    // Assert - exactly one more pull (run B), not two
    expect(pullShare).toHaveBeenCalledTimes(3);
    stopB();
  });
});
