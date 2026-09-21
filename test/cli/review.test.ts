/**
 * Black-box PR review flow (tier 3): the real entrypoint spawned as a
 * subprocess with CUELOOP_GH pointing at a stub gh script that records its
 * args and emits a fixture diff. Covers `review --no-tui` session creation
 * and `review-post` message mapping for every message kind.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { DaemonClient } from "@cueloop/daemon/client";
import type { Thread } from "@cueloop/schema";
import { cliJson, runCli } from "../helpers/cli";

const FIXTURE_DIFF = [
  "diff --git a/a.ts b/a.ts",
  "index 0000001..0000002 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
  "",
].join("\n");

let home: string;
let ghDir: string;
let ghStub: string;
let ghLog: string;

/** Args of every stub invocation, one JSON array per call. */
function ghCalls(): string[][] {
  let raw = "";

  try {
    raw = readFileSync(ghLog, "utf8");
  } catch {
    return [];
  }

  return (
    raw
      .split("\n")
      .filter(Boolean)
      .map((line) => v.parse(v.array(v.string()), JSON.parse(line)))
      // the daemon's PR head-poll runs on a timer and shares this log; drop it so a
      // background poll never lands between a before/after count or as the last call
      .filter((args) => !(args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")))
  );
}

function ghEnv() {
  return { CUELOOP_GH: ghStub };
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-review-"));
  ghDir = mkdtempSync(join(tmpdir(), "cueloop-gh-"));
  ghLog = join(ghDir, "gh.log");
  ghStub = join(ghDir, "gh");
  // Stub gh: record args as JSON lines; `pr diff` emits the fixture,
  // any command mentioning GH_FAIL exits nonzero like a real gh error.
  writeFileSync(
    ghStub,
    [
      `#!${process.execPath}`,
      `const { appendFileSync } = require("node:fs");`,
      `const args = process.argv.slice(2);`,
      `appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");`,
      `if (args.includes("GH_FAIL")) {`,
      `  process.stderr.write("GraphQL: Could not resolve to a PullRequest\\n");`,
      `  process.exit(1);`,
      `}`,
      `if (args[0] === "pr" && args[1] === "diff") {`,
      `  process.stdout.write(${JSON.stringify(FIXTURE_DIFF)});`,
      `}`,
      ``,
    ].join("\n"),
  );
  chmodSync(ghStub, 0o755);
});
afterAll(async () => {
  try {
    const client = await DaemonClient.connect({ home });

    await client.shutdown();
    client.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(ghDir, { recursive: true, force: true });
});

/** Create a PR diff session non-interactively and resolve it with one message. */
async function createResolvedSession(
  pr: string,
  message: string,
  summary: string,
): Promise<Thread> {
  const created = cliJson<Thread>(
    await runCli(home, ["review", pr, "--no-tui"], undefined, ghEnv()),
  );
  const runResult = await runCli(home, [
    "session",
    "send-message",
    created.id,
    "--outcome",
    message,
    "--summary",
    summary,
  ]);

  expect(runResult.code).toBe(0);

  return cliJson<Thread>(runResult);
}

describe("cueloop review (black box)", () => {
  test("--no-tui fetches the PR diff into a session and prints it", async () => {
    // Act
    const runResult = await runCli(home, ["review", "42", "--no-tui"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(0);
    const session = cliJson<Thread>(runResult);

    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.status).toBe("pending");
    expect(session.artifact.type).toBe("diff");
    expect(session.artifact.content).toBe(FIXTURE_DIFF);
    expect(session.artifact.meta.title).toBe("PR 42");
    expect(session.artifact.meta.pr).toBe("42");
    expect(ghCalls()).toContainEqual(["pr", "diff", "42"]);
  });

  test("bare `review` opens the latest pending PR review, never creates - with none it reports nothing to open", async () => {
    // Arrange
    // A fresh home has no pending PR reviews, so the open path has nothing to
    // launch and must fall through to a plain message without ever calling gh.
    const emptyHome = mkdtempSync(join(tmpdir(), "cueloop-review-empty-"));

    try {
      const before = ghCalls().length;

      // Act
      const runResult = await runCli(emptyHome, ["review"], undefined, ghEnv());

      // Assert
      expect(runResult.code).toBe(1);
      expect(runResult.stderr).toContain("no pending PR review - nothing to open");
      expect(ghCalls().length).toBe(before);
    } finally {
      try {
        const client = await DaemonClient.connect({ home: emptyHome });

        await client.shutdown();
        client.close();
      } catch {
        // daemon already gone
      }
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  test("gh diff failure surfaces gh's stderr and exits 1", async () => {
    // Act
    const runResult = await runCli(home, ["review", "GH_FAIL", "--no-tui"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("Could not resolve to a PullRequest");
  });
});

describe("cueloop review-post (black box)", () => {
  test("approved maps to gh pr review --approve with feedback.md as body", async () => {
    // Arrange
    const session = await createResolvedSession("42", "approved", "Ship it.");

    // Act
    const runResult = await runCli(home, ["review-post", session.id, "42"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(0);
    expect(runResult.stdout).toContain("posted approved review to PR 42");
    const call = ghCalls().at(-1)!;

    expect(call.slice(0, 4)).toEqual(["pr", "review", "42", "--approve"]);
    expect(call[4]).toBe("--body");
    expect(call[5]).toBe(session.message!.body);
    expect(call[5]).toContain("Ship it.");
  });

  test("changes_requested maps to --request-changes", async () => {
    // Arrange
    const session = await createResolvedSession("43", "changes_requested", "Rename the constant.");

    // Act
    const runResult = await runCli(home, ["review-post", session.id, "43"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(0);
    const call = ghCalls().at(-1)!;

    expect(call.slice(0, 4)).toEqual(["pr", "review", "43", "--request-changes"]);
    expect(call[5]).toContain("Rename the constant.");
  });

  test("annotations flow into the posted body through feedback.md", async () => {
    // Arrange
    const created = cliJson<Thread>(
      await runCli(home, ["review", "45", "--no-tui"], undefined, ghEnv()),
    );

    // Act
    const a = await runCli(home, [
      "session",
      "annotate",
      created.id,
      "--quote",
      "export const a = 2;",
      "--body",
      "Why bump to 2?",
    ]);

    // Assert
    expect(a.code).toBe(0);

    // Act
    const parsed = await runCli(home, [
      "session",
      "send-message",
      created.id,
      "--outcome",
      "changes_requested",
      "--summary",
      "Explain the bump.",
    ]);

    // Assert
    expect(parsed.code).toBe(0);

    // Act
    const runResult = await runCli(home, ["review-post", created.id, "45"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(0);
    const body = ghCalls().at(-1)![5]!;

    expect(body).toContain("Why bump to 2?");
    expect(body).toContain("Explain the bump.");
  });

  test("unresolved session posts nothing and exits 1", async () => {
    // Arrange
    const created = cliJson<Thread>(
      await runCli(home, ["review", "46", "--no-tui"], undefined, ghEnv()),
    );
    const before = ghCalls().length;

    // Act
    const runResult = await runCli(home, ["review-post", created.id, "46"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("nothing was posted to PR 46");
    expect(ghCalls().length).toBe(before);
  });

  test("gh review failure exits 1", async () => {
    // Arrange
    const session = await createResolvedSession("47", "approved", "Fine.");

    // Act
    const runResult = await runCli(
      home,
      ["review-post", session.id, "GH_FAIL"],
      undefined,
      ghEnv(),
    );

    // Assert
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("Could not resolve to a PullRequest");
  });

  test("missing arguments exit 2", async () => {
    // Act
    const runResult = await runCli(home, ["review-post"], undefined, ghEnv());

    // Assert
    expect(runResult.code).toBe(2);
    expect(runResult.stderr).toContain("usage: cueloop review-post <session-id> <pr>");
  });
});
