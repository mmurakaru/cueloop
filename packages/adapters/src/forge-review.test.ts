import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cueloop/schema";
import { createDeliveredMessageStore } from "./delivered-message-store";
import { createGitHubForgeReviewPort } from "./forge-review";

const home = mkdtempSync(join(tmpdir(), "cueloop-forge-context-"));
const command = join(home, "fake-gh");
const output = join(home, "cwd.log");
const posted = join(home, "posted.json");
const postCount = join(home, "post-count.log");
const message: Message = {
  id: "msg_forge_context",
  outcome: "approved",
  summary: "Ready.",
  body: "Ready.",
  sentAt: "2026-09-21T00:00:00.000Z",
};

writeFileSync(
  command,
  `#!/bin/sh
pwd >> '${output}'
if [ "$1 $2" = "pr diff" ]; then
  printf 'diff --git a/a b/a\\n'
elif [ "$1 $2" = "pr view" ]; then
  printf '%s' '{"number":42,"title":"Fix auth","body":"Details","url":"https://github.com/org/repo/pull/42","author":{"login":"alex"},"baseRefName":"main","baseRefOid":"base123","headRefName":"fix","headRefOid":"head456"}'
elif [ "$1" = "api" ]; then
  printf 'post\n' >> '${postCount}'
  tee '${posted}' >/dev/null
  printf '%s' '{"html_url":"https://github.com/org/repo/pull/42#pullrequestreview-1"}'
fi
`,
);
chmodSync(command, 0o700);

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("createGitHubForgeReviewPort", () => {
  test("imports metadata and runs post-back in the requested repository", async () => {
    const port = createGitHubForgeReviewPort(
      createDeliveredMessageStore(join(home, "delivered.json")),
      command,
    );

    const imported = await port.importPullRequest("42", home);
    await port.postPullRequestMessage("42", message, home);

    expect(imported.pullRequest.headRefOid).toBe("head456");
    expect(readFileSync(output, "utf8").trim().split("\n")).toEqual([
      realpathSync(home),
      realpathSync(home),
      realpathSync(home),
      realpathSync(home),
    ]);
  });

  test("posts selected agent findings as one GitHub review", async () => {
    const port = createGitHubForgeReviewPort(
      createDeliveredMessageStore(join(home, "delivered-comments.json")),
      command,
    );
    const imported = await port.importPullRequest("42", home);

    const input: Parameters<typeof port.postPullRequestComments>[0] = {
      publicationId: "github-review:test-publication",
      pullRequest: imported.pullRequest,
      comments: [
        {
          id: "C1",
          kind: "comment",
          anchor: { quote: "token", prefix: "", suffix: "" },
          body: "Validate expiry.",
          author: "agent",
          reviewComment: {
            severity: "p1",
            title: "Expiry is unchecked",
            path: "src/auth.ts",
            line: 12,
            startLine: 10,
            side: "RIGHT",
          },
          createdAt: "2026-09-24T00:00:00.000Z",
        },
      ],
      cwd: home,
    };

    await port.postPullRequestComments(input);
    await port.postPullRequestComments(input);
    await Promise.all([
      port.postPullRequestComments({ ...input, publicationId: "github-review:concurrent" }),
      port.postPullRequestComments({ ...input, publicationId: "github-review:concurrent" }),
    ]);
    const payload = JSON.parse(readFileSync(posted, "utf8"));

    expect(payload.event).toBe("COMMENT");
    expect(payload.commit_id).toBe("head456");
    expect(payload.comments[0].path).toBe("src/auth.ts");
    expect(payload.comments[0].start_line).toBe(10);
    expect(payload.comments[0].start_side).toBe("RIGHT");
    expect(payload.comments[0].body).toContain("/badges/p1.svg");
    expect(readFileSync(postCount, "utf8").trim().split("\n")).toHaveLength(2);
  });

  test("retries when the PR head moves while its diff is loading", async () => {
    const raceCommand = join(home, "race-gh");
    const viewCount = join(home, "race-view-count");
    const diffCount = join(home, "race-diff-count");

    writeFileSync(
      raceCommand,
      `#!/bin/sh
if [ "$1 $2" = "pr view" ]; then
  count=$(($(cat '${viewCount}' 2>/dev/null || printf 0) + 1))
  printf '%s' "$count" > '${viewCount}'
  if [ "$count" -eq 1 ]; then head=head-old; else head=head-stable; fi
  printf '{"number":42,"title":"Fix auth","body":"Details","url":"https://github.com/org/repo/pull/42","author":{"login":"alex"},"baseRefName":"main","baseRefOid":"base123","headRefName":"fix","headRefOid":"%s"}' "$head"
elif [ "$1 $2" = "pr diff" ]; then
  count=$(($(cat '${diffCount}' 2>/dev/null || printf 0) + 1))
  printf '%s' "$count" > '${diffCount}'
  printf 'diff --git a/a b/a\n# snapshot %s\n' "$count"
fi
`,
    );
    chmodSync(raceCommand, 0o700);
    const port = createGitHubForgeReviewPort(
      createDeliveredMessageStore(join(home, "race-delivered.json")),
      raceCommand,
    );
    const imported = await port.importPullRequest("42", home);

    expect(imported.pullRequest.headRefOid).toBe("head-stable");
    expect(imported.content).toContain("snapshot 2");
  });
});
