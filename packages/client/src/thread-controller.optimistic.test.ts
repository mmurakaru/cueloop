import { describe, expect, test } from "bun:test";
import { SCHEMA_VERSION, type Annotation, type Thread } from "@cueloop/schema";
import { withAnnotationUpserted } from "./thread-controller";

function threadFixture(annotations: Annotation[] = []): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n\nShip it.\n", meta: {} },
    revisions: [
      { revision: 1, content: "# Plan\n\nShip it.\n", submittedAt: "2026-01-01T00:00:00.000Z" },
    ],
    annotations,
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const existing: Annotation = {
  id: "ann_1",
  kind: "comment",
  anchor: { quote: "Ship it.", prefix: "", suffix: "" },
  body: "first",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("withAnnotationUpserted", () => {
  test("a new comment is appended so it paints immediately", () => {
    // Arrange
    const session = threadFixture([existing]);
    const wire = { id: "ann_2", kind: "comment", anchor: existing.anchor, body: "second" };

    // Act
    const next = withAnnotationUpserted(session, wire);

    // Assert
    expect(next.annotations.map((entry) => entry.id)).toEqual(["ann_1", "ann_2"]);
    expect(next.annotations[1]!.body).toBe("second");
    expect(next.annotations[1]!.createdAt).not.toBe("");
  });

  test("an edit replaces the note in place and keeps its timestamp", () => {
    // Arrange
    const session = threadFixture([existing]);
    const wire = { id: "ann_1", kind: "comment", anchor: existing.anchor, body: "edited" };

    // Act
    const next = withAnnotationUpserted(session, wire);

    // Assert - same position, same createdAt, new body (no reorder or timestamp flash)
    expect(next.annotations.map((entry) => entry.id)).toEqual(["ann_1"]);
    expect(next.annotations[0]!.body).toBe("edited");
    expect(next.annotations[0]!.createdAt).toBe(existing.createdAt);
  });

  test("the input session is not mutated", () => {
    // Arrange
    const session = threadFixture([existing]);
    const wire = { id: "ann_2", kind: "comment", anchor: existing.anchor, body: "second" };

    // Act
    withAnnotationUpserted(session, wire);

    // Assert
    expect(session.annotations).toHaveLength(1);
  });
});
