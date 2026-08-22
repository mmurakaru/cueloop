import { describe, expect, test } from "bun:test";
import { registerParticipant } from "./participants";
import { SCHEMA_VERSION, type ReviewSession } from "./types";

function emptySession(): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n", meta: {} },
    revisions: [],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("registerParticipant", () => {
  test("adds a new author with a display name", () => {
    // Act
    const next = registerParticipant(emptySession(), "SHA256:ana", "Ana");

    // Assert
    expect(next.participants).toEqual([{ id: "SHA256:ana", provider: "ssh", name: "Ana" }]);
  });

  test("records presence without a name (renders anonymous)", () => {
    // Act
    const next = registerParticipant(emptySession(), "SHA256:ana");

    // Assert
    expect(next.participants).toEqual([{ id: "SHA256:ana", provider: "ssh" }]);
  });

  test("a nameless revisit never erases a name a past visit set", () => {
    // Arrange
    const named = registerParticipant(emptySession(), "SHA256:ana", "Ana");

    // Act
    const next = registerParticipant(named, "SHA256:ana");

    // Assert
    expect(next).toBe(named);
    expect(next.participants).toEqual([{ id: "SHA256:ana", provider: "ssh", name: "Ana" }]);
  });

  test("a later name updates the existing identity in place", () => {
    // Arrange
    const present = registerParticipant(emptySession(), "SHA256:ana");

    // Act
    const next = registerParticipant(present, "SHA256:ana", "Ana");

    // Assert
    expect(next.participants).toEqual([{ id: "SHA256:ana", provider: "ssh", name: "Ana" }]);
  });
});
