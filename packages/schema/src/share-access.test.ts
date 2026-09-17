import { describe, expect, test } from "bun:test";
import { isShareViewerAllowed } from "./share-access";

describe("isShareViewerAllowed", () => {
  test("an unauthenticated viewer is refused", () => {
    expect(isShareViewerAllowed({ githubLogins: ["octocat"] }, undefined)).toBe(false);
  });

  test("a member is admitted, case-insensitively", () => {
    expect(isShareViewerAllowed({ githubLogins: ["OctoCat"] }, "octocat")).toBe(true);
  });

  test("a non-member is refused", () => {
    expect(isShareViewerAllowed({ githubLogins: ["octocat"] }, "hubot")).toBe(false);
  });

  test("an empty allowlist admits no one", () => {
    expect(isShareViewerAllowed({ githubLogins: [] }, "octocat")).toBe(false);
  });
});
