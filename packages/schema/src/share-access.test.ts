import { describe, expect, test } from "bun:test";
import { isShareViewerAllowed } from "./share-access";

describe("isShareViewerAllowed", () => {
  test("a public link admits an unauthenticated viewer", () => {
    expect(isShareViewerAllowed({ requireAuth: false, allowlist: [] }, undefined)).toBe(true);
  });
  test("an unauthenticated viewer is refused", () => {
    expect(isShareViewerAllowed({ requireAuth: true, allowlist: ["octocat"] }, undefined)).toBe(
      false,
    );
  });

  test("a member is admitted, case-insensitively", () => {
    expect(isShareViewerAllowed({ requireAuth: true, allowlist: ["OctoCat"] }, "octocat")).toBe(
      true,
    );
  });

  test("a non-member is refused", () => {
    expect(isShareViewerAllowed({ requireAuth: true, allowlist: ["octocat"] }, "hubot")).toBe(
      false,
    );
  });

  test("an empty allowlist admits no one", () => {
    expect(isShareViewerAllowed({ requireAuth: true, allowlist: [] }, "octocat")).toBe(false);
  });
});
