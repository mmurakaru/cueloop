import { describe, expect, test } from "bun:test";
import { newAnnotationId, verdictAllows } from "./types";

describe("verdictAllows", () => {
  test("only approve maps to allow", () => {
    expect(verdictAllows("approve")).toBe(true);
    expect(verdictAllows("comment")).toBe(false);
    expect(verdictAllows("request_changes")).toBe(false);
  });
});

describe("newAnnotationId", () => {
  test("unique by construction within a process, even on one millisecond", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newAnnotationId()));
    expect(ids.size).toBe(10_000);
    for (const id of ids) expect(id).toMatch(/^a_[0-9a-z]+_[0-9a-z]+$/);
  });
});
