import { beforeEach, describe, expect, mock, test, type Mock } from "bun:test";
import { ManualClock } from "@opentui/core/testing";
import { SCHEMA_VERSION, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import {
  createReviewController,
  SHARE_RECONNECT_MAX_MS,
  SHARE_RECONNECT_MIN_MS,
  type ShareTransport,
} from "./session-controller";
import type { ShareWatchHandlers } from "./share";

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
  watch: () => () => {},
  parseShareId: (line) => line.match(/^ssh (\S+)@/)?.[1],
  collaboratorAnnotations: (session) => session.annotations.filter((entry) => entry.author),
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

interface FakeSessionClient extends SessionClient {
  sessionAnnotate: Mock<SessionClient["sessionAnnotate"]>;
}

const unimplemented = (member: string) => () =>
  Promise.reject(new Error(`fakeClient does not implement ${member}`));

function fakeClient(session: ReviewSession): FakeSessionClient {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionAnnotate: mock<SessionClient["sessionAnnotate"]>(async () => session),
    sessionRemoveAnnotation: unimplemented("sessionRemoveAnnotation"),
    sessionSetWorkingCopy: unimplemented("sessionSetWorkingCopy"),
    sessionCutBlock: unimplemented("sessionCutBlock"),
    sessionRestoreBlock: unimplemented("sessionRestoreBlock"),
    sessionCurate: unimplemented("sessionCurate"),
    sessionNavigate: unimplemented("sessionNavigate"),
    sessionBranch: unimplemented("sessionBranch"),
    sessionSwitch: unimplemented("sessionSwitch"),
    sessionLabel: unimplemented("sessionLabel"),
    sessionFork: unimplemented("sessionFork"),
    sessionSetViewed: unimplemented("sessionSetViewed"),
    sessionSetShareId: mock(
      async (_id: string, shareId: string) => ((session.shareId = shareId), session),
    ),
    sessionMergeShared: mock(async (_id: string, incoming: { annotations: Annotation[] }) => {
      const known = new Set(session.annotations.map((existing) => existing.id));

      for (const note of incoming.annotations)
        if (!known.has(note.id)) session.annotations.push(note);

      return session;
    }),
    sessionDelete: unimplemented("sessionDelete"),
    sessionSetSelfName: unimplemented("sessionSetSelfName"),
    sessionResolve: unimplemented("sessionResolve"),
    close: () => {},
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connectedController(
  session: ReviewSession,
  clock?: ManualClock,
  transport: ShareTransport = shareTransport,
): Promise<{ controller: ReturnType<typeof createReviewController>; client: FakeSessionClient }> {
  const client = fakeClient(session);
  const controller = createReviewController({
    sessionId: session.id,
    openClient: async () => client,
    clock,
    shareTransport: transport,
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

    client.sessionAnnotate.mockImplementationOnce(async () => {
      throw new Error("session is resolved");
    });

    // Act
    controller.updateAnnotation("a1", "revised body");
    await tick();

    // Assert - a failed local write must never leak to the share
    expect(pushShare).not.toHaveBeenCalled();
  });
});

describe("reply", () => {
  test("a reply shares the root's anchor, names it in replyTo, and mirrors up", async () => {
    // Arrange
    pushShare.mockClear();
    const { controller, client } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy", annotations: [annotation("a1", "SHA256:ana")] }),
    );

    // Act
    const id = controller.reply("a1", "agreed");
    await tick();

    // Assert
    const wire = client.sessionAnnotate.mock.calls.at(-1)![1];

    expect(wire).toEqual({
      id: id!,
      kind: "comment",
      anchor: { quote: "Plan", prefix: "", suffix: "" },
      body: "agreed",
      replyTo: "a1",
    });
    expect(pushShare.mock.calls[0]?.[1]).toEqual([wire]);
  });

  test("editing a reply keeps its reply link", async () => {
    // Arrange
    const { controller, client } = await connectedController(
      sessionFixture({
        annotations: [
          annotation("a1", "SHA256:ana"),
          { ...annotation("a2", "SHA256:me"), replyTo: "a1" },
        ],
      }),
    );

    // Act
    controller.updateAnnotation("a2", "revised reply");
    await tick();

    // Assert
    expect(client.sessionAnnotate.mock.calls.at(-1)?.[1]).toMatchObject({
      id: "a2",
      body: "revised reply",
      replyTo: "a1",
    });
  });

  test("a reply to a reply hangs off the discussion's root comment", async () => {
    // Arrange
    const { controller, client } = await connectedController(
      sessionFixture({
        annotations: [
          annotation("a1", "SHA256:ana"),
          { ...annotation("a2", "SHA256:bob"), replyTo: "a1" },
        ],
      }),
    );

    // Act
    controller.reply("a2", "same thread");
    await tick();

    // Assert
    expect(client.sessionAnnotate.mock.calls.at(-1)?.[1]).toMatchObject({ replyTo: "a1" });
  });

  test("replying to an unknown annotation does nothing", async () => {
    // Arrange
    const { controller, client } = await connectedController(sessionFixture());

    // Act + Assert
    expect(controller.reply("missing", "x")).toBeUndefined();
    expect(client.sessionAnnotate).not.toHaveBeenCalled();
  });
});

describe("startShareSync", () => {
  /** A fake watch stream: records handlers so a test can push a session or drop the link. */
  const streams: Array<{ shareId: string; handlers: ShareWatchHandlers; stopped: boolean }> = [];
  const watchShare = mock((shareId: string, handlers: ShareWatchHandlers) => {
    const stream = { shareId, handlers, stopped: false };

    streams.push(stream);

    return () => {
      stream.stopped = true;
    };
  });
  const liveTransport: ShareTransport = { ...shareTransport, watch: watchShare };

  beforeEach(() => {
    streams.length = 0;
    watchShare.mockClear();
    pullShare.mockClear();
    remote = sessionFixture({ annotations: [] });
  });

  test("connect pulls once to catch up, then follows the stream and merges each session it delivers", async () => {
    // Arrange
    const clock = new ManualClock();
    const { controller, client } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
      liveTransport,
    );

    // Act
    controller.startShareSync();
    await tick();

    // Assert - one catch-up pull, one open stream on the share
    expect(pullShare).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.shareId).toBe("p_abc123xy");

    // Act - the gateway pushes a change carrying Ana's note
    streams[0]!.handlers.onSession(
      sessionFixture({ annotations: [annotation("a9", "SHA256:ana")] }),
    );
    await tick();

    // Assert - merged without another pull
    expect(client.sessionMergeShared).toHaveBeenLastCalledWith(
      "ses_1",
      expect.objectContaining({
        annotations: [expect.objectContaining({ id: "a9", author: "SHA256:ana" })],
      }),
    );
    expect(pullShare).toHaveBeenCalledTimes(1);
  });

  test("a dropped stream reconnects with doubling backoff and catches up on each connect", async () => {
    // Arrange
    const clock = new ManualClock();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
      liveTransport,
    );

    controller.startShareSync();
    await tick();

    // Act - the link drops: nothing until the floor delay has passed
    streams[0]!.handlers.onClose("ssh exited 255");
    clock.advance(SHARE_RECONNECT_MIN_MS - 1);
    await tick();
    expect(streams).toHaveLength(1);
    clock.advance(1);
    await tick();

    // Assert - reconnected, with a fresh catch-up pull
    expect(streams).toHaveLength(2);
    expect(pullShare).toHaveBeenCalledTimes(2);

    // Act - drops again: the wait doubles
    streams[1]!.handlers.onClose("ssh exited 255");
    clock.advance(SHARE_RECONNECT_MIN_MS);
    await tick();
    expect(streams).toHaveLength(2);
    clock.advance(SHARE_RECONNECT_MIN_MS);
    await tick();
    expect(streams).toHaveLength(3);

    // Act - a delivered session resets the backoff to the floor
    streams[2]!.handlers.onSession(remote);
    streams[2]!.handlers.onClose("ssh exited 255");
    clock.advance(SHARE_RECONNECT_MIN_MS);
    await tick();

    // Assert
    expect(streams).toHaveLength(4);
  });

  test("stop closes the stream and a late close never reconnects", async () => {
    // Arrange
    const clock = new ManualClock();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
      liveTransport,
    );
    const stop = controller.startShareSync();

    await tick();

    // Act
    stop();
    streams[0]!.handlers.onClose("killed");
    clock.advance(SHARE_RECONNECT_MAX_MS * 2);
    await tick();

    // Assert
    expect(streams[0]!.stopped).toBe(true);
    expect(streams).toHaveLength(1);
  });

  test("a restart replaces the stream instead of doubling it", async () => {
    // Arrange
    const clock = new ManualClock();
    const { controller } = await connectedController(
      sessionFixture({ shareId: "p_abc123xy" }),
      clock,
      liveTransport,
    );

    controller.startShareSync();
    await tick();

    // Act
    controller.startShareSync();
    await tick();
    streams[0]!.handlers.onClose("stale");
    clock.advance(SHARE_RECONNECT_MAX_MS * 2);
    await tick();

    // Assert - the first stream was stopped and its close re-armed nothing
    expect(streams[0]!.stopped).toBe(true);
    expect(streams).toHaveLength(2);
    expect(streams[1]!.stopped).toBe(false);
  });
});
