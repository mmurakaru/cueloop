/** Black-box cueloop pair command tests against an isolated daemon home and VCS repo. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import type { Thread } from "@cueloop/schema";
import { cliJson, runCli } from "../helpers/cli";
import { createTestGitRepo, type TestGitRepo } from "../helpers/git-repo";

let home: string;
let repo: TestGitRepo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-pair-"));
  repo = createTestGitRepo([
    {
      path: "src/example.ts",
      before: "export const example = 1;\n",
      after: "export const example = 2;\n",
    },
  ]);
});

afterEach(async () => {
  try {
    const client = await DaemonClient.connect({ home });

    await client.shutdown();
    client.close();
  } catch {
    // daemon already gone
  }
  repo.cleanup();
  rmSync(home, { recursive: true, force: true });
});

describe("cueloop pair", () => {
  test("prints and reuses the repository workbench Thread ID without opening the TUI", async () => {
    const first = await runCli(home, ["pair", "--no-tui"], undefined, undefined, repo.dir);

    expect(first.code).toBe(0);
    const firstId = cliJson<{ threadId: string }>(first).threadId;
    const thread = cliJson<Thread>(
      await runCli(home, ["session", "get", firstId], undefined, undefined, repo.dir),
    );

    expect(thread.workspace.repoRoot).toBe(realpathSync(repo.dir));
    expect(thread.artifact.meta.workbench).toBe(true);
    expect(thread.artifact.content).toContain("src/example.ts");

    const second = await runCli(home, ["pair", "--no-tui"], undefined, undefined, repo.dir);

    expect(cliJson<{ threadId: string }>(second).threadId).toBe(firstId);
  });
});
