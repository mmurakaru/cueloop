import { describe, expect, test } from "bun:test";
import {
  annotationTarget,
  ARTIFACT_TYPES,
  WORKFLOW_KINDS,
  isArtifactType,
  isMarkdownArtifact,
  newAnnotationId,
  messageAllows,
} from "./types";

describe("annotationTarget", () => {
  test("an annotation with no target means the reviewed artifact", () => {
    expect(annotationTarget({ target: undefined })).toEqual({ kind: "artifact" });
  });

  test("a stamped target is returned as-is", () => {
    const target = { kind: "file", path: "src/x.ts", rev: "worktree" } as const;

    expect(annotationTarget({ target })).toBe(target);
  });
});

describe("ARTIFACT_TYPES", () => {
  test("names every primitive exactly once", () => {
    expect([...ARTIFACT_TYPES].sort()).toEqual(["diff", "plan", "prototype", "reply"]);
    expect(new Set(ARTIFACT_TYPES).size).toBe(ARTIFACT_TYPES.length);
  });

  test("isArtifactType accepts every member and rejects strangers", () => {
    for (const type of ARTIFACT_TYPES) expect(isArtifactType(type)).toBe(true);
    expect(isArtifactType("blueprint")).toBe(false);
    expect(isArtifactType("")).toBe(false);
  });
});

describe("WORKFLOW_KINDS", () => {
  test("review and refine are workflows, not artifact types", () => {
    expect(WORKFLOW_KINDS).toEqual(["plan", "reply", "prototype", "diff", "review", "refine"]);
    expect(isArtifactType("review")).toBe(false);
    expect(isArtifactType("refine")).toBe(false);
  });
});

describe("messageAllows", () => {
  test("only approve maps to allow", () => {
    expect(messageAllows("approved")).toBe(true);
    expect(messageAllows("changes_requested")).toBe(false);
    expect(messageAllows("changes_requested")).toBe(false);
  });
});

describe("isMarkdownArtifact", () => {
  test("plan, reply, and prototype are markdown; diff is not", () => {
    expect(isMarkdownArtifact("plan")).toBe(true);
    expect(isMarkdownArtifact("reply")).toBe(true);
    expect(isMarkdownArtifact("prototype")).toBe(true);
    expect(isMarkdownArtifact("diff")).toBe(false);
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
