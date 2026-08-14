import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type ReviewSession } from "@cueloop/schema";
import type { SessionClient } from "@cueloop/daemon/client";
import { shareSession, type ShareDeps } from "./share-command";

function sessionFixture(id: string): ReviewSession {
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
  };
}

/** A SessionClient that answers get/list from a fixed list. */
function fakeClient(sessions: ReviewSession[]): SessionClient {
  return {
    sessionGet: async (id: string) => sessions.find((session) => session.id === id)!,
    sessionList: async () => sessions,
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
});
