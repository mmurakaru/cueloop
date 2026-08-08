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
  test("time component + random suffix; unique within one millisecond", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newAnnotationId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^a_[0-9a-z]+$/);
  });
});
