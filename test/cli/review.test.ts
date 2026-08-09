/**
 * Black-box PR review flow (tier 3): the real entrypoint spawned as a
 * subprocess with CUELOOP_GH pointing at a stub gh script that records its
 * args and emits a fixture diff. Covers `review --no-tui` session creation
 * and `review-post` verdict mapping for every verdict kind.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import type { ReviewSession } from "@cueloop/schema";
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
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function ghEnv(): Record<string, string> {
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

/** Create a PR diff session non-interactively and resolve it with one verdict. */
async function createResolvedSession(pr: string, verdict: string, summary: string): Promise<ReviewSession> {
  const created = cliJson<ReviewSession>(await runCli(home, ["review", pr, "--no-tui"], undefined, ghEnv()));
  const runResult = await runCli(home, ["session", "resolve", created.id, "--verdict", verdict, "--summary", summary]);
  expect(runResult.code).toBe(0);
  return cliJson<ReviewSession>(runResult);
}

describe("cueloop review (black box)", () => {
  test("--no-tui fetches the PR diff into a session and prints it", async () => {
    const runResult = await runCli(home, ["review", "42", "--no-tui"], undefined, ghEnv());
    expect(runResult.code).toBe(0);
    const session = cliJson<ReviewSession>(runResult);
    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.status).toBe("pending");
    expect(session.artifact.type).toBe("diff");
    expect(session.artifact.content).toBe(FIXTURE_DIFF);
    expect(session.artifact.meta.title).toBe("PR 42");
    expect(session.artifact.meta.pr).toBe("42");
    expect(ghCalls()).toContainEqual(["pr", "diff", "42"]);
  });

  test("missing pr argument exits 2 without calling gh", async () => {
    const before = ghCalls().length;
    const runResult = await runCli(home, ["review"], undefined, ghEnv());
    expect(runResult.code).toBe(2);
    expect(runResult.stderr).toContain("usage: cueloop review <pr>");
    expect(ghCalls().length).toBe(before);
  });

  test("gh diff failure surfaces gh's stderr and exits 1", async () => {
    const runResult = await runCli(home, ["review", "GH_FAIL", "--no-tui"], undefined, ghEnv());
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("Could not resolve to a PullRequest");
  });
});

describe("cueloop review-post (black box)", () => {
  test("approve maps to gh pr review --approve with feedback.md as body", async () => {
    const session = await createResolvedSession("42", "approve", "Ship it.");
    const runResult = await runCli(home, ["review-post", session.id, "42"], undefined, ghEnv());
    expect(runResult.code).toBe(0);
    expect(runResult.stdout).toContain("posted approve review to PR 42");
    const call = ghCalls().at(-1)!;
    expect(call.slice(0, 4)).toEqual(["pr", "review", "42", "--approve"]);
    expect(call[4]).toBe("--body");
    expect(call[5]).toBe(session.verdict!.feedback);
    expect(call[5]).toContain("Ship it.");
  });

  test("request_changes maps to --request-changes", async () => {
    const session = await createResolvedSession("43", "request_changes", "Rename the constant.");
    const runResult = await runCli(home, ["review-post", session.id, "43"], undefined, ghEnv());
    expect(runResult.code).toBe(0);
    const call = ghCalls().at(-1)!;
    expect(call.slice(0, 4)).toEqual(["pr", "review", "43", "--request-changes"]);
    expect(call[5]).toContain("Rename the constant.");
  });

  test("comment maps to --comment", async () => {
    const session = await createResolvedSession("44", "comment", "Looks reasonable overall.");
    const runResult = await runCli(home, ["review-post", session.id, "44"], undefined, ghEnv());
    expect(runResult.code).toBe(0);
    const call = ghCalls().at(-1)!;
    expect(call.slice(0, 4)).toEqual(["pr", "review", "44", "--comment"]);
    expect(call[5]).toContain("Looks reasonable overall.");
  });

  test("annotations flow into the posted body through feedback.md", async () => {
    const created = cliJson<ReviewSession>(await runCli(home, ["review", "45", "--no-tui"], undefined, ghEnv()));
    const a = await runCli(home, [
      "session",
      "annotate",
      created.id,
      "--quote",
      "export const a = 2;",
      "--body",
      "Why bump to 2?",
    ]);
    expect(a.code).toBe(0);
    const parsed = await runCli(home, ["session", "resolve", created.id, "--verdict", "request_changes", "--summary", "Explain the bump."]);
    expect(parsed.code).toBe(0);
    const runResult = await runCli(home, ["review-post", created.id, "45"], undefined, ghEnv());
    expect(runResult.code).toBe(0);
    const body = ghCalls().at(-1)![5]!;
    expect(body).toContain("Why bump to 2?");
    expect(body).toContain("Explain the bump.");
  });

  test("unresolved session posts nothing and exits 1", async () => {
    const created = cliJson<ReviewSession>(await runCli(home, ["review", "46", "--no-tui"], undefined, ghEnv()));
    const before = ghCalls().length;
    const runResult = await runCli(home, ["review-post", created.id, "46"], undefined, ghEnv());
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("nothing was posted to PR 46");
    expect(ghCalls().length).toBe(before);
  });

  test("gh review failure exits 1", async () => {
    const session = await createResolvedSession("47", "approve", "Fine.");
    const runResult = await runCli(home, ["review-post", session.id, "GH_FAIL"], undefined, ghEnv());
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("Could not resolve to a PullRequest");
  });

  test("missing arguments exit 2", async () => {
    const runResult = await runCli(home, ["review-post"], undefined, ghEnv());
    expect(runResult.code).toBe(2);
    expect(runResult.stderr).toContain("usage: cueloop review-post <session-id> <pr>");
  });
});
