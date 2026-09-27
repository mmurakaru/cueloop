/** Black-box cueloop pair command tests against an isolated daemon home and VCS repo. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  test("opens the pairing layout in a focused Herdr tab and reuses it", async () => {
    const logPath = join(home, "herdr.log");
    const binPath = join(home, "herdr.sh");

    writeFileSync(
      binPath,
      `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "tab" ] && [ "$2" = "create" ]; then
  printf '{"result":{"root_pane":{"pane_id":"w1:p2","tab_id":"w1:t2"}}}'
fi
if [ "$1" = "pane" ] && [ "$2" = "get" ]; then
  printf '{"result":{"pane":{"pane_id":"w1:p2"}}}'
fi
`,
    );
    chmodSync(binPath, 0o755);
    const herdrEnvironment = {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_BIN_PATH: binPath,
    };
    const first = cliJson<{ threadId: string; startedAt: string; openStatus: string }>(
      await runCli(home, ["pair", "--open-tab", "--no-tui"], undefined, herdrEnvironment, repo.dir),
    );

    expect(first.openStatus).toBe("opened");
    expect(Date.parse(first.startedAt)).toBeGreaterThan(0);
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
      `tab create --cwd ${realpathSync(repo.dir)} --label Workbench --focus`,
      `pane send-text w1:p2 cueloop pair ${first.threadId}`,
      "pane send-keys w1:p2 enter",
    ]);

    const second = cliJson<{ threadId: string; openStatus: string }>(
      await runCli(home, ["pair", "--open-tab", "--no-tui"], undefined, herdrEnvironment, repo.dir),
    );

    expect(second).toMatchObject({ threadId: first.threadId, openStatus: "focused" });
    expect(readFileSync(logPath, "utf8").trim().split("\n").slice(3)).toEqual([
      "pane get w1:p2",
      "tab focus w1:t2",
    ]);

    const third = cliJson<{ threadId: string; openStatus: string }>(
      await runCli(
        home,
        ["pair", "--open-tab", first.threadId, "--no-tui"],
        undefined,
        herdrEnvironment,
        repo.dir,
      ),
    );

    expect(third).toMatchObject({ threadId: first.threadId, openStatus: "focused" });
  });

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

  test("rejects a non-workbench Thread ID", async () => {
    const plan = cliJson<Thread>(
      await runCli(home, ["session", "create", "--type", "plan", "--agent", "test"], "# Plan"),
    );
    const result = await runCli(
      home,
      ["pair", plan.id, "--no-tui"],
      undefined,
      undefined,
      repo.dir,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Thread ${plan.id} is not an open workbench`);
  });

  test("rejects a resolved workbench Thread ID", async () => {
    const created = await runCli(home, ["pair", "--no-tui"], undefined, undefined, repo.dir);
    const threadId = cliJson<{ threadId: string }>(created).threadId;

    await runCli(home, ["session", "send-message", threadId, "--outcome", "approved"]);
    const result = await runCli(
      home,
      ["pair", threadId, "--no-tui"],
      undefined,
      undefined,
      repo.dir,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Thread ${threadId} is not an open workbench`);
  });
});
