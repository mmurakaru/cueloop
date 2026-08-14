import { describe, expect, mock, test } from "bun:test";
import { SCHEMA_VERSION, type ReviewSession } from "@cueloop/schema";
import { unpackSessionBlob } from "@cueloop/daemon/share-blob";
import type { SessionClient } from "@cueloop/daemon/client";
import { shareSession, type ShareIo } from "./share-command";

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

function ioSpy(overrides: Partial<ShareIo> = {}): ShareIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    upload: mock(async () => "ssh p_abc123xy@cueloop.dev"),
    copy: mock(async () => true),
    out: (message: string) => void lines.push(message),
    lines,
    ...overrides,
  };
}

describe(shareSession, () => {
  test("packs the named session and reports the copied ssh line", async () => {
    // Arrange
    const io = ioSpy({
      upload: mock(async (blob: Buffer) => {
        // the blob must decode back to the session we asked to share
        expect(unpackSessionBlob(blob).id).toBe("ses_2");
        return "ssh p_abc123xy@cueloop.dev";
      }),
    });

    // Act
    const code = await shareSession(fakeClient([sessionFixture("ses_1"), sessionFixture("ses_2")]), { sessionId: "ses_2" }, io);

    // Assert
    expect(code).toBe(0);
    expect(io.lines).toEqual(["share link copied - ssh p_abc123xy@cueloop.dev"]);
  });

  test("without an id, shares the most recent session", async () => {
    // Arrange
    const io = ioSpy({ upload: mock(async (blob: Buffer) => (expect(unpackSessionBlob(blob).id).toBe("ses_2"), "ssh p_zzzzzzzz@cueloop.dev")) });

    // Act
    await shareSession(fakeClient([sessionFixture("ses_1"), sessionFixture("ses_2")]), {}, io);

    // Assert
    expect(io.upload).toHaveBeenCalledTimes(1);
  });

  test("falls back to printing the line when the clipboard is unavailable", async () => {
    // Arrange
    const io = ioSpy({ copy: mock(async () => false) });

    // Act
    await shareSession(fakeClient([sessionFixture("ses_1")]), { sessionId: "ses_1" }, io);

    // Assert
    expect(io.lines).toEqual(["ssh p_abc123xy@cueloop.dev"]);
  });

  test("reports nothing to share when the inbox is empty", async () => {
    // Arrange
    const io = ioSpy();

    // Act
    const code = await shareSession(fakeClient([]), {}, io);

    // Assert
    expect(code).toBe(1);
    expect(io.lines[0]).toContain("no plan to share");
    expect(io.upload).not.toHaveBeenCalled();
  });
});
