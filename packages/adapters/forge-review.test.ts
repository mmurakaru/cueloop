import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cueloop/schema";
import { DeliveredMessageStore } from "./delivered-message-store";
import { GitHubForgeReviewPort } from "./forge-review";

const home = mkdtempSync(join(tmpdir(), "cueloop-forge-context-"));
const command = join(home, "fake-gh");
const output = join(home, "cwd.log");
const message: Message = {
  id: "msg_forge_context",
  outcome: "approved",
  summary: "Ready.",
  body: "Ready.",
  sentAt: "2026-09-21T00:00:00.000Z",
};

writeFileSync(command, `#!/bin/sh\npwd >> '${output}'\nprintf 'diff --git a/a b/a\\n'\n`);
chmodSync(command, 0o700);

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("GitHubForgeReviewPort", () => {
  test("runs both import and post-back in the requested repository", async () => {
    const port = new GitHubForgeReviewPort(
      new DeliveredMessageStore(join(home, "delivered.json")),
      command,
    );

    await port.importPullRequest("42", home);
    await port.postPullRequestMessage("42", message, home);

    expect(readFileSync(output, "utf8").trim().split("\n")).toEqual([
      realpathSync(home),
      realpathSync(home),
    ]);
  });
});
