import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";

// Stub the ssh transport so no subprocess spawns; the controller under test
// imports these from "./share".
const publishShare = mock(async () => ({ line: "ssh p_abc123xy@cueloop.dev", copied: true }));
let remote: ReviewSession;
const pullShare = mock(async () => remote);
mock.module("./share", () => ({
  publishShare,
  pullShare,
  shareIdFromLine: (line: string) => line.match(/^ssh (\S+)@/)?.[1],
}));

const { createReviewController } = await import("./session-controller");

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
  return { id, kind: "comment", anchor: { quote: "Plan", prefix: "", suffix: "" }, body: "note", author, createdAt: "2026-01-01T00:00:00.000Z" };
}

function fakeClient(session: ReviewSession): SessionClient {
  return {
    onEvent: () => () => {},
    subscribe: async () => {},
    sessionGet: async () => session,
    sessionList: async () => [session],
    sessionSetShareId: mock(async (_id: string, shareId: string) => ((session.shareId = shareId), session)),
    sessionMergeAnnotations: mock(async (_id: string, incoming: Annotation[]) => {
      const known = new Set(session.annotations.map((existing) => existing.id));
      for (const note of incoming) if (!known.has(note.id)) session.annotations.push(note);
      return session;
    }),
    close: () => {},
  } as unknown as SessionClient;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connectedController(session: ReviewSession): Promise<{ controller: ReturnType<typeof createReviewController>; client: SessionClient }> {
  const client = fakeClient(session);
  const controller = createReviewController({ sessionId: session.id, openClient: async () => client });
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
});

describe("pullShared", () => {
  test("unions collaborator notes in when the plan was shared", async () => {
    // Arrange
    remote = sessionFixture({ annotations: [annotation("a1", "SHA256:mate")] });
    const { controller, client } = await connectedController(sessionFixture({ shareId: "p_abc123xy" }));

    // Act
    controller.pullShared();
    await tick();

    // Assert
    expect(pullShare).toHaveBeenCalledWith("p_abc123xy");
    expect(client.sessionMergeAnnotations).toHaveBeenCalledWith("ses_1", remote.annotations);
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
    expect(client.sessionMergeAnnotations).not.toHaveBeenCalled();
  });
});
