import { describe, expect, test } from "bun:test";
import { isMarkdownArtifact, newAnnotationId, verdictAllows } from "./types";

describe("verdictAllows", () => {
  test("only approve maps to allow", () => {
    expect(verdictAllows("approve")).toBe(true);
    expect(verdictAllows("comment")).toBe(false);
    expect(verdictAllows("request_changes")).toBe(false);
  });
});

describe("isMarkdownArtifact", () => {
  test("plan and reply are markdown; diff and prototype are not", () => {
    expect(isMarkdownArtifact("plan")).toBe(true);
    expect(isMarkdownArtifact("reply")).toBe(true);
    expect(isMarkdownArtifact("diff")).toBe(false);
    expect(isMarkdownArtifact("prototype")).toBe(false);
  });
});

describe("newAnnotationId", () => {
  test("unique by construction within a process, even on one millisecond", () => {
    // Act
    const ids = new Set(Array.from({ length: 10_000 }, () => newAnnotationId()));

    // Assert
    expect(ids.size).toBe(10_000);
    for (const id of ids) expect(id).toMatch(/^a_[0-9a-z]+_[0-9a-z]+$/);
  });
});
