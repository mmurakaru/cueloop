import { describe, expect, test } from "bun:test";
import { prSnapshot } from "./gh";

describe("prSnapshot", () => {
  test("retries until the diff and head are one stable snapshot", async () => {
    const refs = [
      { baseSha: "base-1", headSha: "head-1" },
      { baseSha: "base-1", headSha: "head-2" },
      { baseSha: "base-1", headSha: "head-2" },
      { baseSha: "base-1", headSha: "head-2" },
    ];
    const patches = ["patch-1", "patch-2"];

    const snapshot = await prSnapshot(
      "https://github.com/org/repo/pull/1",
      3,
      async () => refs.shift() ?? null,
      async () => patches.shift() ?? null,
    );

    expect(snapshot).toEqual({ patch: "patch-2", baseSha: "base-1", headSha: "head-2" });
  });

  test("returns no snapshot when the head keeps moving", async () => {
    let head = 0;

    const snapshot = await prSnapshot(
      "https://github.com/org/repo/pull/1",
      2,
      async () => ({ baseSha: "base", headSha: `head-${head++}` }),
      async () => "patch",
    );

    expect(snapshot).toBeNull();
  });

  test("retries when only the base moves", async () => {
    const refs = [
      { baseSha: "base-1", headSha: "head" },
      { baseSha: "base-2", headSha: "head" },
      { baseSha: "base-2", headSha: "head" },
      { baseSha: "base-2", headSha: "head" },
    ];
    const patches = ["old-base-patch", "new-base-patch"];

    const snapshot = await prSnapshot(
      "https://github.com/org/repo/pull/1",
      3,
      async () => refs.shift() ?? null,
      async () => patches.shift() ?? null,
    );

    expect(snapshot).toEqual({
      patch: "new-base-patch",
      baseSha: "base-2",
      headSha: "head",
    });
  });
});
