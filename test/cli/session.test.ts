/**
 * Black-box CLI contract tests (tier 3): the real entrypoint spawned as a
 * subprocess against an isolated CUELOOP_HOME, including daemon autostart
 * and the cross-process wait/resolve round-trip.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import type { ReviewSession } from "@cueloop/schema";
import { cliJson, runCli } from "../helpers/cli";

const PLAN = "# Plan\n\n## Steps\n\nDo the migration in two phases.\n";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-cli-"));
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
});

describe("cueloop session (black box)", () => {
  let sessionId: string;

  test("create autostarts the daemon and prints the session", async () => {
    // Act
    const created = await runCli(
      home,
      ["session", "create", "--type", "plan", "--title", "Migration", "--agent", "test"],
      PLAN,
    );

    // Assert
    expect(created.code).toBe(0);
    const session = cliJson<ReviewSession>(created);
    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.artifact.content).toBe(PLAN);
    expect(session.status).toBe("pending");
    sessionId = session.id;
  });

  test("list and get see the session from a fresh process", async () => {
    // Act
    const list = cliJson<ReviewSession[]>(
      await runCli(home, ["session", "list", "--status", "pending"]),
    );

    // Assert
    expect(list.some((candidate) => candidate.id === sessionId)).toBe(true);

    // Act
    const got = cliJson<ReviewSession>(await runCli(home, ["session", "get", sessionId]));

    // Assert
    expect(got.artifact.meta.title).toBe("Migration");
  });

  test("wait times out to pending without losing the session", async () => {
    // Act
    const waited = await runCli(home, ["session", "wait", sessionId, "--timeout-ms", "100"]);

    // Assert
    expect(cliJson<{ status: string }>(waited)).toEqual({ status: "pending" });
  });

  test("annotate + resolve from separate processes; wait collects the verdict", async () => {
    // Act
    const annotated = await runCli(home, [
      "session",
      "annotate",
      sessionId,
      "--quote",
      "two phases",
      "--prefix",
      "migration in ",
      "--suffix",
      ".",
      "--body",
      "Name the phases.",
    ]);

    // Assert
    expect(annotated.code).toBe(0);

    // Act
    const resolved = await runCli(home, [
      "session",
      "resolve",
      sessionId,
      "--verdict",
      "request_changes",
      "--summary",
      "Phase names please.",
    ]);

    // Assert
    expect(resolved.code).toBe(0);

    // Act
    const verdict = cliJson<{ status: string; allow: boolean; feedback: string }>(
      await runCli(home, ["session", "wait", sessionId, "--timeout-ms", "1000"]),
    );

    // Assert
    expect(verdict.status).toBe("resolved");
    expect(verdict.allow).toBe(false);
    expect(verdict.feedback).toContain("Name the phases.");
    expect(verdict.feedback).toContain("> two phases");
  });

  test("revision reopens through the CLI", async () => {
    // Act
    const revised = cliJson<ReviewSession>(
      await runCli(
        home,
        ["session", "submit-revision", sessionId],
        PLAN + "\n## Phase names\n\nAlpha, beta.\n",
      ),
    );

    // Assert
    expect(revised.status).toBe("pending");
    expect(revised.revisions.length).toBe(2);
  });

  test("--addressed marks the reported annotation addressed on resubmit", async () => {
    // Arrange
    const before = cliJson<ReviewSession>(await runCli(home, ["session", "get", sessionId]));
    const annotationId = before.annotations[0]!.id;
    expect(before.annotations[0]!.resolution).toBeUndefined();

    // Act
    const revised = cliJson<ReviewSession>(
      await runCli(
        home,
        ["session", "submit-revision", sessionId, "--addressed", annotationId],
        PLAN + "\n## Phase names\n\nAlpha, beta, gamma.\n",
      ),
    );

    // Assert
    expect(revised.annotations[0]!.resolution).toEqual({ revision: 3, source: "agent" });
  });

  test("create inside herdr opens a tab that launches the review", async () => {
    // Arrange
    const logPath = join(home, "herdr-cli.log");
    const binPath = join(home, "herdr-cli.sh");
    writeFileSync(
      binPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nif [ "$1" = "tab" ] && [ "$2" = "create" ]; then\n  printf '{"result":{"root_pane":{"pane_id":"w1:p2","tab_id":"w1:t2"}}}'\nfi\n`,
    );
    chmodSync(binPath, 0o755);

    // Act
    const created = await runCli(
      home,
      ["session", "create", "--type", "plan", "--title", "Auto Open", "--cwd", home],
      PLAN,
      { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: binPath },
    );

    // Assert
    expect(created.code).toBe(0);
    const session = cliJson<ReviewSession>(created);
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    expect(lines).toEqual([
      `tab create --cwd ${home} --label Auto Open --focus`,
      `pane send-text w1:p2 cueloop ${session.id}`,
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("create outside herdr opens no tab", async () => {
    // Arrange
    const logPath = join(home, "herdr-none.log");
    const binPath = join(home, "herdr-none.sh");
    writeFileSync(binPath, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\n`);
    chmodSync(binPath, 0o755);

    // Act
    // HERDR_ENV off: the bin path alone must not open a pane
    const created = await runCli(
      home,
      ["session", "create", "--type", "plan", "--title", "No Pane"],
      PLAN,
      {
        HERDR_ENV: "0",
        HERDR_PANE_ID: "w1:p1",
        HERDR_BIN_PATH: binPath,
      },
    );

    // Assert
    expect(created.code).toBe(0);
    expect(existsSync(logPath)).toBe(false);
  });

  test("annotate --author registers the collaborator in the participant registry", async () => {
    // Act
    const annotated = cliJson<ReviewSession>(
      await runCli(home, [
        "session",
        "annotate",
        sessionId,
        "--quote",
        "two phases",
        "--author",
        "SHA256:ana",
        "--author-name",
        "Ana",
        "--body",
        "Whose phases?",
      ]),
    );

    // Assert
    const note = annotated.annotations.find((candidate) => candidate.body === "Whose phases?")!;
    expect(note.author).toBe("SHA256:ana");
    expect(annotated.participants).toContainEqual({
      id: "SHA256:ana",
      provider: "ssh",
      name: "Ana",
    });
  });

  test("annotate --action expands the quick-action into the body", async () => {
    // Act
    const annotated = cliJson<ReviewSession>(
      await runCli(
        home,
        ["session", "annotate", sessionId, "--quote", "two phases", "--action", "Out of scope"],
        undefined,
        { CUELOOP_CONFIG: join(home, "no-such-config.toml") },
      ),
    );

    // Assert
    const note = annotated.annotations.find((candidate) =>
      candidate.body.startsWith("Out of scope"),
    )!;
    expect(note.body).toContain("capture it as a follow-up");
  });

  test("actions list prints the numbered quick-action vocabulary", async () => {
    // Act
    const actions = cliJson<{ index: number; prompt: string; metadata?: string }[]>(
      await runCli(home, ["actions", "list"], undefined, {
        CUELOOP_CONFIG: join(home, "no-such-config.toml"),
      }),
    );

    // Assert
    expect(actions).toHaveLength(7);
    expect(actions[0]).toMatchObject({ index: 1, prompt: "Zoom out, research in depth" });
    expect(actions[2]).toMatchObject({ index: 3, prompt: "Out of scope" });
  });

  test("actions resolve from the session's repo, not the caller's cwd", async () => {
    // Arrange - a repo whose .cueloop config defines its own quick action
    const repo = mkdtempSync(join(tmpdir(), "cueloop-repo-"));
    mkdirSync(join(repo, ".cueloop"));
    writeFileSync(
      join(repo, ".cueloop", "config.toml"),
      `[[actions]]\nprompt = "Repo special"\nmetadata = "the repo-local system prompt"\n`,
    );
    const scoped = cliJson<ReviewSession>(
      await runCli(
        home,
        ["session", "create", "--type", "plan", "--title", "Scoped", "--cwd", repo],
        PLAN,
      ),
    );

    // Act - listing and expanding both key off the session's repo, run from elsewhere
    const listed = cliJson<{ index: number; prompt: string; metadata?: string }[]>(
      await runCli(home, ["actions", "list", "--session", scoped.id], undefined, {
        CUELOOP_CONFIG: join(home, "no-such-config.toml"),
      }),
    );
    const annotated = cliJson<ReviewSession>(
      await runCli(
        home,
        ["session", "annotate", scoped.id, "--quote", "two phases", "--action", "Repo special"],
        undefined,
        { CUELOOP_CONFIG: join(home, "no-such-config.toml") },
      ),
    );

    // Assert
    expect(listed).toEqual([
      { index: 1, prompt: "Repo special", metadata: "the repo-local system prompt" },
    ]);
    expect(annotated.annotations[0]!.body).toBe("Repo special\n\nthe repo-local system prompt");
    rmSync(repo, { recursive: true, force: true });
  });

  test("help output and unknown verbs", async () => {
    // Act
    const help = await runCli(home, ["help"]);

    // Assert
    expect(help.stdout).toContain("cueloop session <verb>");

    // Act
    const bad = await runCli(home, ["session", "frobnicate"]);

    // Assert
    expect(bad.code).toBe(2);
  });
});
