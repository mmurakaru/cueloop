import { describe, expect, test } from "bun:test";
import { SCHEMA_VERSION, type Thread } from "./types";
import { threadShareLinks, withShareLinks } from "./share-links";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n", meta: {} },
    revisions: [{ revision: 1, content: "# Plan\n", submittedAt: "2026-01-01T00:00:00.000Z" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("share-link migration", () => {
  test("a never-shared thread has no links", () => {
    expect(threadShareLinks(thread())).toBeUndefined();
    expect(withShareLinks(thread()).shares).toBeUndefined();
  });

  test("a legacy private share migrates into a one-element list", () => {
    const legacy = thread({
      shareId: "p_abc123xy",
      access: { githubLogins: ["octocat"] },
      owner: "SHA256:owner",
      shareBranch: "feature",
    });

    expect(withShareLinks(legacy).shares).toEqual([
      {
        id: "p_abc123xy",
        requireAuth: true,
        allowlist: ["octocat"],
        owner: "SHA256:owner",
        shareBranch: "feature",
      },
    ]);
  });

  test("a legacy public share migrates as requireAuth false with an empty allowlist", () => {
    const legacy = thread({ shareId: "p_public00", owner: "SHA256:owner" });
    const [link] = withShareLinks(legacy).shares!;

    expect(link).toMatchObject({ id: "p_public00", requireAuth: false, allowlist: [] });
  });

  test("a thread that already has shares is returned untouched", () => {
    const modern = thread({
      shares: [{ id: "p_modern00", name: "team", requireAuth: false, allowlist: [] }],
      // stale legacy fields must not override the explicit shares
      shareId: "p_legacy00",
    });

    expect(withShareLinks(modern).shares).toEqual([
      { id: "p_modern00", name: "team", requireAuth: false, allowlist: [] },
    ]);
  });
});
