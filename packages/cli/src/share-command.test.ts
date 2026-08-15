import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { pullSession, shareSession, type PullDeps, type ShareDeps } from "./share-command";

function sessionFixture(id: string, overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
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

function annotationFixture(id: string, author: string): Annotation {
  return { id, kind: "comment", anchor: { quote: "Plan", prefix: "", suffix: "" }, body: "note", author, createdAt: "2026-01-01T00:00:00.000Z" };
}

/** A SessionClient that answers get/list from a fixed list and records the share/merge verbs. */
function fakeClient(sessions: ReviewSession[]): SessionClient {
  return {
    sessionGet: async (id: string) => sessions.find((session) => session.id === id)!,
    sessionList: async () => sessions,
    sessionSetShareId: mock(async (id: string, shareId: string) => {
      const session = sessions.find((candidate) => candidate.id === id)!;
      session.shareId = shareId;
      return session;
    }),
    sessionMergeAnnotations: mock(async (id: string, incoming: Annotation[]) => {
      const session = sessions.find((candidate) => candidate.id === id)!;
      const known = new Set(session.annotations.map((annotation) => annotation.id));
      for (const annotation of incoming) if (!known.has(annotation.id)) session.annotations.push(annotation);
      return session;
    }),
  } as unknown as SessionClient;
}

function depsSpy(overrides: Partial<ShareDeps> = {}): ShareDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    publish: mock(async () => ({ line: "ssh p_abc123xy@cueloop.dev", copied: true })),
    out: (message: string) => void lines.push(message),
    lines,
    ...overrides,
  };
}

describe(shareSession, () => {
  test("publishes the named session and reports the copied ssh line", async () => {
    // Arrange
    const publish = mock(async (session: ReviewSession) => (expect(session.id).toBe("ses_2"), { line: "ssh p_abc123xy@cueloop.dev", copied: true }));
    const deps = depsSpy({ publish });

    // Act
    const code = await shareSession(fakeClient([sessionFixture("ses_1"), sessionFixture("ses_2")]), { sessionId: "ses_2" }, deps);

    // Assert
    expect(code).toBe(0);
    expect(deps.lines).toEqual(["share link copied - ssh p_abc123xy@cueloop.dev"]);
  });

  test("without an id, shares the most recent session", async () => {
    // Arrange
    const publish = mock(async (session: ReviewSession) => (expect(session.id).toBe("ses_2"), { line: "ssh p_zzzzzzzz@cueloop.dev", copied: true }));
    const deps = depsSpy({ publish });

    // Act
    await shareSession(fakeClient([sessionFixture("ses_1"), sessionFixture("ses_2")]), {}, deps);

    // Assert
    expect(deps.publish).toHaveBeenCalledTimes(1);
  });

  test("prints the bare line when the clipboard is unavailable", async () => {
    // Arrange
    const deps = depsSpy({ publish: mock(async () => ({ line: "ssh p_abc123xy@cueloop.dev", copied: false })) });

    // Act
    await shareSession(fakeClient([sessionFixture("ses_1")]), { sessionId: "ses_1" }, deps);

    // Assert
    expect(deps.lines).toEqual(["ssh p_abc123xy@cueloop.dev"]);
  });

  test("reports nothing to share when the inbox is empty", async () => {
    // Arrange
    const deps = depsSpy();

    // Act
    const code = await shareSession(fakeClient([]), {}, deps);

    // Assert
    expect(code).toBe(1);
    expect(deps.lines[0]).toContain("no plan to share");
    expect(deps.publish).not.toHaveBeenCalled();
  });

  test("stamps the share id on the session so a later pull can find it", async () => {
    // Arrange
    const session = sessionFixture("ses_1");
    const client = fakeClient([session]);
    const deps = depsSpy();

    // Act
    await shareSession(client, { sessionId: "ses_1" }, deps);

    // Assert
    expect(client.sessionSetShareId).toHaveBeenCalledWith("ses_1", "p_abc123xy");
  });
});

function pullDepsSpy(remote: ReviewSession): PullDeps & { lines: string[] } {
  const lines: string[] = [];
  return { pull: mock(async () => remote), out: (message: string) => void lines.push(message), lines };
}

describe(pullSession, () => {
  test("unions collaborator notes in and reports the count", async () => {
    // Arrange
    const local = sessionFixture("ses_1", { shareId: "p_abc123xy", annotations: [annotationFixture("a1", "SHA256:owner")] });
    const client = fakeClient([local]);
    const remote = sessionFixture("ses_1", {
      annotations: [annotationFixture("a1", "SHA256:owner"), annotationFixture("a2", "SHA256:mate")],
    });
    const deps = pullDepsSpy(remote);

    // Act
    const code = await pullSession(client, { sessionId: "ses_1" }, deps);

    // Assert
    expect(code).toBe(0);
    expect(deps.pull).toHaveBeenCalledWith("p_abc123xy", { host: undefined, port: undefined });
    expect(local.annotations.map((annotation) => annotation.id)).toEqual(["a1", "a2"]);
    expect(deps.lines).toEqual(["pulled 1 new annotation"]);
  });

  test("reports when nothing new came back", async () => {
    // Arrange
    const local = sessionFixture("ses_1", { shareId: "p_abc123xy", annotations: [annotationFixture("a1", "SHA256:owner")] });
    const deps = pullDepsSpy(sessionFixture("ses_1", { annotations: [annotationFixture("a1", "SHA256:owner")] }));

    // Act
    await pullSession(fakeClient([local]), { sessionId: "ses_1" }, deps);

    // Assert
    expect(deps.lines).toEqual(["no new annotations"]);
  });

  test("refuses to pull a plan that was never shared", async () => {
    // Arrange
    const deps = pullDepsSpy(sessionFixture("ses_1"));

    // Act
    const code = await pullSession(fakeClient([sessionFixture("ses_1")]), { sessionId: "ses_1" }, deps);

    // Assert
    expect(code).toBe(1);
    expect(deps.lines[0]).toContain("no shared plan");
    expect(deps.pull).not.toHaveBeenCalled();
  });
});
