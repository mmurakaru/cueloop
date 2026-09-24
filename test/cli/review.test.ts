/**
 * Black-box GitHub review flow: the real CLI talks to a stub gh binary and a
 * real daemon, so import, agent findings, explicit publication, and failures
 * cross the same process and socket boundaries as production.
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

function addedLinesDiff(lines: string[]): string {
  return [
    "diff --git a/a.ts b/a.ts",
    "index 0000001..0000002 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

let home: string;
let ghDir: string;
let ghStub: string;
let ghLog: string;
let payloadLog: string;

const PostedPayloadSchema = v.object({
  event: v.string(),
  body: v.optional(v.string()),
  comments: v.array(
    v.object({
      body: v.string(),
      path: v.string(),
      line: v.number(),
      start_line: v.optional(v.number()),
    }),
  ),
});

function lines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function ghCalls(): string[][] {
  return lines(ghLog)
    .map((line) => v.parse(v.array(v.string()), JSON.parse(line)))
    .filter((args) => !(args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")));
}

function postedPayloads(): Array<v.InferOutput<typeof PostedPayloadSchema>> {
  return lines(payloadLog).map((line) => v.parse(PostedPayloadSchema, JSON.parse(line)));
}

function ghEnv(extra: Record<string, string> = {}) {
  return { CUELOOP_GH: ghStub, ...extra };
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-review-"));
  ghDir = mkdtempSync(join(tmpdir(), "cueloop-gh-"));
  ghLog = join(ghDir, "gh.log");
  payloadLog = join(ghDir, "payloads.log");
  ghStub = join(ghDir, "gh");
  writeFileSync(
    ghStub,
    [
      `#!${process.execPath}`,
      `const { appendFileSync, readFileSync } = require("node:fs");`,
      `const args = process.argv.slice(2);`,
      `appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");`,
      `if (args.includes("GH_FAIL")) {`,
      `  process.stderr.write("GraphQL: Could not resolve to a PullRequest\\n");`,
      `  process.exit(1);`,
      `}`,
      `if (args[0] === "pr" && args[1] === "diff") {`,
      `  process.stdout.write(${JSON.stringify(FIXTURE_DIFF)});`,
      `} else if (args[0] === "pr" && args[1] === "view" && args.includes("-q")) {`,
      `  process.stdout.write("head456\\n");`,
      `} else if (args[0] === "pr" && args[1] === "view") {`,
      `  const number = Number(args[2]) || 42;`,
      `  process.stdout.write(JSON.stringify({ number, title: "Fix auth", body: "Original PR body.", url: "https://github.com/org/repo/pull/" + number, author: { login: "alex" }, baseRefName: "main", baseRefOid: process.env.CUELOOP_GH_BASE || "base123", headRefName: "fix", headRefOid: process.env.CUELOOP_GH_HEAD || "head456" }));`,
      `} else if (args[0] === "api") {`,
      `  if (process.env.CUELOOP_GH_FAIL_POST === "1") {`,
      `    process.stderr.write("GitHub review post failed\\n");`,
      `    process.exit(1);`,
      `  }`,
      `  const payload = readFileSync(0, "utf8");`,
      `  appendFileSync(${JSON.stringify(payloadLog)}, payload + "\\n");`,
      `  process.stdout.write(JSON.stringify({ html_url: "https://github.com/org/repo/pull/42#pullrequestreview-1" }));`,
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

async function createReview(pr = "42"): Promise<Thread> {
  return cliJson<Thread>(await runCli(home, ["review", pr, "--no-tui"], undefined, ghEnv()));
}

async function resolveReview(session: Thread, outcome = "approved", summary = "Ship it.") {
  const result = await runCli(home, [
    "session",
    "send-message",
    session.id,
    "--outcome",
    outcome,
    "--summary",
    summary,
  ]);

  expect(result.code).toBe(0);
}

describe("cueloop review", () => {
  test("imports PR metadata, the exact diff, and a readable PR brief", async () => {
    const result = await runCli(home, ["review", "42", "--no-tui"], undefined, ghEnv());

    expect(result.code).toBe(0);
    const session = cliJson<Thread>(result);

    expect(session.artifact.content).toBe(FIXTURE_DIFF);
    expect(session.artifact.meta.pr).toBe("42");
    expect(session.artifact.meta.prHeadSha).toBe("head456");
    expect(session.artifact.meta.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(session.artifact.meta.prBrief).toBe(
      "# Fix auth\n\n## PR description\n\nOriginal PR body.",
    );
    expect(ghCalls()).toContainEqual(["pr", "diff", "https://github.com/org/repo/pull/42"]);
  });

  test("reports gh import failures", async () => {
    const result = await runCli(home, ["review", "GH_FAIL", "--no-tui"], undefined, ghEnv());

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not resolve to a PullRequest");
  });

  test("refuses to open a Thread when the reviewed head moved", async () => {
    const result = await runCli(
      home,
      ["review", "42", "--head-sha", "head456", "--no-tui"],
      undefined,
      ghEnv({ CUELOOP_GH_HEAD: "head789" }),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("reviewed head456, current head789");
  });

  test("prints the configured review skill and workspace", async () => {
    const result = await runCli(home, ["review-config"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ skill: "code-review", workspace: "worktree" });
  });
});

describe("explicit GitHub publication", () => {
  test("publishes selected agent findings as one GitHub review", async () => {
    const session = await createReview();
    const comment = await runCli(
      home,
      [
        "review-comment",
        session.id,
        "--path",
        "a.ts",
        "--line",
        "1",
        "--side",
        "RIGHT",
        "--severity",
        "p1",
        "--title",
        "Value changed without coverage",
        "--body",
        "Add a regression test.",
        "--suggestion",
        "export const a = testedValue;",
        "--prompt",
        "Add a focused test for this value.",
      ],
      undefined,
      ghEnv(),
    );

    expect(comment.code).toBe(0);
    expect(comment.stdout.trim()).toBe("C1");
    await resolveReview(session);
    const post = await runCli(
      home,
      ["review-post", session.id, "--comments", "C1", "--event", "approve"],
      undefined,
      ghEnv(),
    );

    expect(post.stderr).toBe("");
    expect(post.code).toBe(0);
    expect(post.stdout).toContain("posted 1 review comment to PR 42");
    const call = ghCalls().at(-1)!;
    const payload = postedPayloads().at(-1)!;

    expect(call[0]).toBe("api");
    expect(payload.event).toBe("APPROVE");
    expect(payload.body).toBe("Ship it.");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]!.path).toBe("a.ts");
    expect(payload.comments[0]!.line).toBe(1);
    expect(payload.comments[0]!.body).toContain("/badges/p1.svg");
    expect(payload.comments[0]!.body).toContain("```suggestion");
    expect(payload.comments[0]!.body).toContain("<details><summary>Prompt to fix</summary>");
    const publicationCount = postedPayloads().length;
    const retry = await runCli(
      home,
      ["review-post", session.id, "--comments", "C1", "--event", "approve"],
      undefined,
      ghEnv(),
    );

    expect(retry.code).toBe(0);
    expect(postedPayloads()).toHaveLength(publicationCount);
  });

  test("human comments remain local and are never emitted as inline findings", async () => {
    const session = await createReview("43");
    const annotation = await runCli(home, [
      "session",
      "annotate",
      session.id,
      "--quote",
      "export const a = 2;",
      "--body",
      "Private reviewer note.",
    ]);

    expect(annotation.code).toBe(0);
    await resolveReview(session, "changes_requested", "Please address the selected findings.");
    const post = await runCli(
      home,
      ["review-post", session.id, "--event", "request-changes"],
      undefined,
      ghEnv(),
    );

    expect(post.stderr).toBe("");
    expect(post.code).toBe(0);
    const payload = postedPayloads().at(-1)!;

    expect(payload.body).toBe("Please address the selected findings.");
    expect(payload.body).not.toContain("Private reviewer note.");
    expect(payload.comments).toEqual([]);
  });

  test("refuses unresolved Threads and failed GitHub posts", async () => {
    const unresolved = await createReview("44");
    const refused = await runCli(home, ["review-post", unresolved.id], undefined, ghEnv());

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("is unresolved");
    await resolveReview(unresolved);
    const failed = await runCli(
      home,
      ["review-post", unresolved.id],
      undefined,
      ghEnv({ CUELOOP_GH_FAIL_POST: "1" }),
    );

    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("GitHub review post failed");
  });

  for (const [name, changedRefs] of [
    ["head", { CUELOOP_GH_HEAD: "head789" }],
    ["base", { CUELOOP_GH_BASE: "base789" }],
  ] as const) {
    test(`refuses publication when the remote ${name} moved`, async () => {
      const session = await createReview(`stale-${name}`);

      await resolveReview(session);
      const publicationCount = postedPayloads().length;
      const post = await runCli(
        home,
        ["review-post", session.id, "--event", "approve"],
        undefined,
        ghEnv(changedRefs),
      );

      expect(post.code).toBe(1);
      expect(post.stderr).toContain("pull request changed since this review");
      expect(postedPayloads()).toHaveLength(publicationCount);
    });
  }

  test("rejects findings whose line is not in the imported diff", async () => {
    const session = await createReview("45");
    const result = await runCli(
      home,
      [
        "review-comment",
        session.id,
        "--path",
        "a.ts",
        "--line",
        "99",
        "--side",
        "RIGHT",
        "--severity",
        "p2",
        "--title",
        "Bad anchor",
        "--body",
        "This must not publish.",
      ],
      undefined,
      ghEnv(),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("a.ts:99 is not present");
  });

  test("never overwrites a reviewer comment that uses the requested finding ID", async () => {
    const session = await createReview("47");
    const reviewer = await runCli(home, [
      "session",
      "annotate",
      session.id,
      "--annotation-id",
      "C1",
      "--quote",
      "export const a = 2;",
      "--body",
      "Reviewer comment.",
    ]);

    expect(reviewer.code).toBe(0);
    const finding = await runCli(
      home,
      [
        "review-comment",
        session.id,
        "--id",
        "C1",
        "--path",
        "a.ts",
        "--line",
        "1",
        "--side",
        "RIGHT",
        "--severity",
        "p2",
        "--title",
        "Collision",
        "--body",
        "Must not replace the reviewer.",
      ],
      undefined,
      ghEnv(),
    );

    expect(finding.code).toBe(1);
    expect(finding.stderr).toContain("already belongs to another reviewer");
  });

  test("reanchors a finding when a refreshed diff moves its quoted line", async () => {
    const session = await createReview("46");
    const comment = await runCli(
      home,
      [
        "review-comment",
        session.id,
        "--path",
        "a.ts",
        "--line",
        "1",
        "--side",
        "RIGHT",
        "--severity",
        "p2",
        "--title",
        "Moved finding",
        "--body",
        "Keep this attached to the changed value.",
      ],
      undefined,
      ghEnv(),
    );

    expect(comment.code).toBe(0);
    const client = await DaemonClient.connect({ home });
    const movedDiff = [
      "diff --git a/a.ts b/a.ts",
      "index 0000001..0000002 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " export const before = true;",
      "-export const a = 1;",
      "+export const a = 2;",
      "",
    ].join("\n");

    await client.sessionSubmitRevision(session.id, movedDiff);
    client.close();
    await resolveReview(session);
    const post = await runCli(
      home,
      ["review-post", session.id, "--comments", "C1"],
      undefined,
      ghEnv(),
    );

    expect(post.code).toBe(0);
    const payload = postedPayloads().at(-1)!;

    expect(payload.comments[0]!.line).toBe(2);
  });

  test("uses anchor context instead of an identical quote at the old line", async () => {
    const session = await createReview("47");
    const comment = await runCli(
      home,
      [
        "review-comment",
        session.id,
        "--path",
        "a.ts",
        "--line",
        "1",
        "--side",
        "RIGHT",
        "--severity",
        "p1",
        "--title",
        "Repeated line",
        "--body",
        "Keep the original context.",
      ],
      undefined,
      ghEnv(),
    );

    expect(comment.code).toBe(0);
    const client = await DaemonClient.connect({ home });
    const repeatedDiff = [
      "diff --git a/a.ts b/a.ts",
      "index 0000001..0000002 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-export const other = 1;",
      "+export const a = 2;",
      "@@ -10 +10 @@",
      "-export const a = 1;",
      "+export const a = 2;",
      "",
    ].join("\n");

    await client.sessionSubmitRevision(session.id, repeatedDiff);
    client.close();
    await resolveReview(session);
    const post = await runCli(
      home,
      ["review-post", session.id, "--comments", "C1"],
      undefined,
      ghEnv(),
    );

    expect(post.stderr).toBe("");
    expect(post.code).toBe(0);
    expect(postedPayloads().at(-1)!.comments[0]!.line).toBe(10);
  });

  for (const scenario of [
    {
      name: "lines inserted before the range",
      lines: ["inserted before", "before context", "start target", "middle context", "end target"],
      startLine: 3,
      line: 5,
    },
    {
      name: "lines inserted inside the range",
      lines: ["before context", "start target", "middle context", "inserted inside", "end target"],
      startLine: 2,
      line: 5,
    },
    {
      name: "lines inserted after the range",
      lines: ["before context", "start target", "middle context", "end target", "inserted after"],
      startLine: 2,
      line: 4,
    },
    {
      name: "duplicate endpoint text",
      lines: [
        "end target",
        "wrong context",
        "before context",
        "start target",
        "middle context",
        "end target",
      ],
      startLine: 4,
      line: 6,
    },
  ]) {
    test(`reanchors both ends of a multiline finding after ${scenario.name}`, async () => {
      const session = await createReview();
      const client = await DaemonClient.connect({ home });

      await client.sessionSubmitRevision(
        session.id,
        addedLinesDiff(["before context", "start target", "middle context", "end target"]),
      );
      client.close();
      const comment = await runCli(
        home,
        [
          "review-comment",
          session.id,
          "--path",
          "a.ts",
          "--start-line",
          "2",
          "--line",
          "4",
          "--side",
          "RIGHT",
          "--severity",
          "p1",
          "--title",
          "Multiline finding",
          "--body",
          "Keep both endpoints attached.",
        ],
        undefined,
        ghEnv(),
      );

      expect(comment.code).toBe(0);
      const revisionClient = await DaemonClient.connect({ home });

      await revisionClient.sessionSubmitRevision(session.id, addedLinesDiff(scenario.lines));
      revisionClient.close();
      await resolveReview(session);
      const post = await runCli(
        home,
        ["review-post", session.id, "--comments", "C1"],
        undefined,
        ghEnv(),
      );

      expect(post.stderr).toBe("");
      expect(post.code).toBe(0);
      expect(postedPayloads().at(-1)!.comments[0]).toMatchObject({
        start_line: scenario.startLine,
        line: scenario.line,
      });
    });
  }
});
