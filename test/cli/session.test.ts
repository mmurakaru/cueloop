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
import type { HarnessBinding, PendingDelivery, Thread } from "@cueloop/schema";
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
    const session = cliJson<Thread>(created);

    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.artifact.content).toBe(PLAN);
    expect(session.status).toBe("pending");
    sessionId = session.id;
  });

  test("create accepts a reply artifact and titles it from the first heading", async () => {
    // Act
    const created = await runCli(
      home,
      ["session", "create", "--type", "reply", "--agent", "test"],
      "# Findings\n\nThe cache is fine.\n",
    );

    // Assert
    expect(created.code).toBe(0);
    const session = cliJson<Thread>(created);

    expect(session.artifact.type).toBe("reply");
    expect(session.artifact.meta.title).toBe("Findings");
  });

  test("create refuses an unknown artifact type with the supported list", async () => {
    // Act
    const created = await runCli(home, ["session", "create", "--type", "blueprint"], "body\n");

    // Assert
    expect(created.code).toBe(2);
    expect(created.stderr).toContain('unknown artifact type "blueprint"');
    expect(created.stderr).toContain("plan, diff, prototype, reply");
  });

  test("list and get see the session from a fresh process", async () => {
    // Act
    const list = cliJson<Thread[]>(await runCli(home, ["session", "list", "--status", "pending"]));

    // Assert
    expect(list.some((candidate) => candidate.id === sessionId)).toBe(true);

    // Act
    const got = cliJson<Thread>(await runCli(home, ["session", "get", sessionId]));

    // Assert
    expect(got.artifact.meta.title).toBe("Migration");
  });

  test("wait times out to pending without losing the session", async () => {
    // Act
    const waited = await runCli(home, ["session", "wait", sessionId, "--timeout-ms", "100"]);

    // Assert
    expect(cliJson<{ status: string }>(waited)).toEqual({ status: "pending" });
  });

  test("bind, deliver, and acknowledge a Message across CLI processes", async () => {
    const created = cliJson<Thread>(
      await runCli(home, ["session", "create", "--type", "plan", "--agent", "fake"], PLAN),
    );
    const binding = cliJson<HarnessBinding>(
      await runCli(home, [
        "session",
        "bind-harness",
        created.id,
        "--harness",
        "fake",
        "--harness-session-id",
        "fake_1",
      ]),
    );

    expect(binding.threadId).toBe(created.id);
    expect(
      (await runCli(home, ["session", "send-message", created.id, "--outcome", "approved"])).code,
    ).toBe(0);
    const pending = cliJson<PendingDelivery[]>(
      await runCli(home, ["session", "pending-deliveries", binding.id]),
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]!.message.outcome).toBe("approved");
    expect(
      (await runCli(home, ["session", "acknowledge-delivery", pending[0]!.delivery.id])).code,
    ).toBe(0);
    expect(
      cliJson<PendingDelivery[]>(await runCli(home, ["session", "pending-deliveries", binding.id])),
    ).toEqual([]);
  });

  test("annotate + resolve from separate processes; wait collects the message", async () => {
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
      "send-message",
      sessionId,
      "--outcome",
      "changes_requested",
      "--summary",
      "Phase names please.",
    ]);

    // Assert
    expect(resolved.code).toBe(0);

    // Act
    const message = cliJson<{
      status: string;
      allow: boolean;
      message: { body: string; outcome: string; id: string };
    }>(await runCli(home, ["session", "wait", sessionId, "--timeout-ms", "1000"]));

    // Assert
    expect(message.status).toBe("resolved");
    expect(message.allow).toBe(false);
    expect(message.message.outcome).toBe("changes_requested");
    expect(message.message.body).toContain("Name the phases.");
    expect(message.message.body).toContain("> two phases");
  });

  test("revision reopens through the CLI", async () => {
    // Act
    const revised = cliJson<Thread>(
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
    const before = cliJson<Thread>(await runCli(home, ["session", "get", sessionId]));
    const annotationId = before.annotations[0]!.id;

    expect(before.annotations[0]!.resolution).toBeUndefined();

    // Act
    const revised = cliJson<Thread>(
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
      {
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p1",
        HERDR_WORKSPACE_ID: "w1",
        HERDR_BIN_PATH: binPath,
      },
    );

    // Assert
    expect(created.code).toBe(0);
    const session = cliJson<Thread>(created);
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);

    expect(lines).toEqual([
      `tab create --workspace w1 --cwd ${home} --label Auto Open --focus`,
      `pane send-text w1:p2 cueloop ${session.id}`,
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("personal pane setting opens a 50 percent right-hand Herdr pane", async () => {
    const configPath = join(home, "herdr-pane.toml");
    const logPath = join(home, "herdr-pane-cli.log");
    const binPath = join(home, "herdr-pane-cli.sh");

    writeFileSync(configPath, '[integrations.herdr]\nthread_surface = "pane"\n');
    writeFileSync(
      binPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nif [ "$1" = "pane" ] && [ "$2" = "split" ]; then\n  printf '{"result":{"pane":{"pane_id":"w1:p3"}}}'\nfi\n`,
    );
    chmodSync(binPath, 0o755);

    const created = await runCli(
      home,
      ["session", "create", "--type", "plan", "--title", "Pane Open", "--cwd", home],
      PLAN,
      {
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p1",
        HERDR_TAB_ID: "w1:t1",
        HERDR_BIN_PATH: binPath,
        CUELOOP_CONFIG: configPath,
      },
    );

    expect(created.code).toBe(0);
    const session = cliJson<Thread>(created);

    expect(readFileSync(logPath, "utf8").split("\n").filter(Boolean)).toEqual([
      `pane split w1:p1 --direction right --ratio 0.5 --cwd ${home} --focus`,
      `pane send-text w1:p3 cueloop ${session.id}`,
      "pane send-keys w1:p3 enter",
    ]);
    expect(session.status).toBe("pending");
    const client = await DaemonClient.connect({ home });

    try {
      expect(await client.herdrGetThreadSurface(session.id)).toEqual({
        mode: "pane",
        tabId: "w1:t1",
        paneId: "w1:p3",
      });
    } finally {
      client.close();
    }
  });

  test("failed Herdr launch returns a manual command and keeps the Thread pending", async () => {
    const created = await runCli(
      home,
      ["session", "create", "--type", "plan", "--title", "Manual Open"],
      PLAN,
      {
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p1",
        HERDR_BIN_PATH: join(home, "missing-herdr"),
        CUELOOP_CONFIG: join(home, "missing-config.toml"),
      },
    );

    expect(created.code).toBe(0);
    const session = cliJson<Thread>(created);

    expect(created.stderr).toContain(`Open cueloop threads: cueloop ${session.id}`);
    expect(session.status).toBe("pending");
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
    const annotated = cliJson<Thread>(
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
    const annotated = cliJson<Thread>(
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
    expect(actions).toHaveLength(8);
    expect(actions[0]).toMatchObject({ index: 1, prompt: "Zoom out, research in depth" });
    expect(actions[2]).toMatchObject({ index: 3, prompt: "Out of scope" });
    expect(actions[7]).toMatchObject({ index: 8, prompt: "LGTM" });
  });

  test("annotate --reply-to borrows the root's anchor and links the reply to it", async () => {
    // Arrange
    const withRoot = cliJson<Thread>(
      await runCli(home, [
        "session",
        "annotate",
        sessionId,
        "--annotation-id",
        "root_cli",
        "--quote",
        "two phases",
        "--body",
        "Why two?",
      ]),
    );

    expect(withRoot.annotations.some((annotation) => annotation.id === "root_cli")).toBe(true);

    // Act: a reply, then a reply to the reply
    await runCli(home, [
      "session",
      "annotate",
      sessionId,
      "--annotation-id",
      "reply_cli",
      "--reply-to",
      "root_cli",
      "--body",
      "Because of rollout.",
      "--author",
      "SHA256:ana",
    ]);
    const nested = cliJson<Thread>(
      await runCli(home, [
        "session",
        "annotate",
        sessionId,
        "--annotation-id",
        "nested_cli",
        "--reply-to",
        "reply_cli",
        "--body",
        "Agreed.",
      ]),
    );

    // Assert: both hang off the root and share its anchor
    const byId = new Map(nested.annotations.map((annotation) => [annotation.id, annotation]));

    expect(byId.get("reply_cli")).toMatchObject({
      replyTo: "root_cli",
      anchor: byId.get("root_cli")!.anchor,
    });
    expect(byId.get("nested_cli")).toMatchObject({ replyTo: "root_cli" });
  });

  test("annotate --selector anchors a prototype comment to an element", async () => {
    // Act
    const annotated = cliJson<Thread>(
      await runCli(home, [
        "session",
        "annotate",
        sessionId,
        "--selector",
        "main > h1",
        "--body",
        "Heading too loud.",
      ]),
    );

    // Assert
    const note = annotated.annotations.find(
      (annotation) => annotation.body === "Heading too loud.",
    );

    expect(note?.anchor.selector).toBe("main > h1");
  });

  test("remove takes a comment away; an agent removes only the author's it is bound to", async () => {
    // Arrange: the owner's and Ana's comments
    await runCli(home, [
      "session",
      "annotate",
      sessionId,
      "--annotation-id",
      "own_rm",
      "--quote",
      "two phases",
      "--body",
      "mine",
    ]);
    await runCli(home, [
      "session",
      "annotate",
      sessionId,
      "--annotation-id",
      "ana_rm",
      "--quote",
      "two phases",
      "--body",
      "hers",
      "--author",
      "SHA256:ana",
    ]);

    // Act + Assert: the agent cannot touch the owner's
    const refused = await runCli(home, [
      "session",
      "remove",
      sessionId,
      "own_rm",
      "--role",
      "agent",
      "--author",
      "SHA256:ana",
    ]);

    expect(refused.code).not.toBe(0);

    // Act: hers goes; the owner removes its own without naming anyone
    const afterAna = cliJson<Thread>(
      await runCli(home, [
        "session",
        "remove",
        sessionId,
        "ana_rm",
        "--role",
        "agent",
        "--author",
        "SHA256:ana",
      ]),
    );
    const afterOwn = cliJson<Thread>(
      await runCli(home, ["session", "remove", sessionId, "own_rm"]),
    );

    // Assert
    expect(afterAna.annotations.some((annotation) => annotation.id === "ana_rm")).toBe(false);
    expect(afterOwn.annotations.some((annotation) => annotation.id === "own_rm")).toBe(false);
  });

  test("name-self registers the display name of the author an agent acts as", async () => {
    // Act
    const named = cliJson<Thread>(
      await runCli(home, [
        "session",
        "name-self",
        sessionId,
        "Ana",
        "--author",
        "SHA256:ana",
        "--role",
        "agent",
      ]),
    );

    // Assert
    expect(named.participants).toContainEqual({ id: "SHA256:ana", provider: "ssh", name: "Ana" });
  });

  test("events streams a session's changes with the entry each one appended", async () => {
    // Arrange: a follower that prints the first event and exits
    const follower = runCli(home, ["session", "events", sessionId, "--once"]);

    await Bun.sleep(600);

    // Act: a comment lands while it listens
    const annotated = cliJson<Thread>(
      await runCli(home, [
        "session",
        "annotate",
        sessionId,
        "--annotation-id",
        "evt_cli",
        "--quote",
        "two phases",
        "--body",
        "seen live",
      ]),
    );

    // Assert
    const event = cliJson<{ event: string; sessionId: string; entryId?: string }>(await follower);

    expect(event.event).toBe("session.updated");
    expect(event.sessionId).toBe(sessionId);
    expect(event.entryId).toBe(annotated.history!.entries.at(-1)!.id);
  });

  test("cut and restore edit the working copy through the daemon and leave reviewer revisions", async () => {
    // Arrange: block 2 of the plan is its first paragraph
    const before = cliJson<Thread>(await runCli(home, ["session", "get", sessionId]));
    const paragraph = before.artifact.content.split("\n\n")[2]!;

    // Act
    const cut = cliJson<Thread>(await runCli(home, ["session", "cut", sessionId, "2"]));

    // Assert
    expect(cut.workingCopy).toBeDefined();
    expect(cut.workingCopy).not.toContain(paragraph.split("\n")[0]);
    expect(cut.history!.entries.at(-1)).toMatchObject({ type: "revision", by: "reviewer" });

    // Act: put it back where it came from
    const blockLine = before.artifact.content.split("\n").indexOf(paragraph.split("\n")[0]!);
    const restored = cliJson<Thread>(
      await runCli(home, ["session", "restore", sessionId, "2", "--line", String(blockLine)]),
    );

    // Assert: a copy that reads as the submitted revision is dropped
    expect(restored.workingCopy).toBeUndefined();
  });

  test("curate is refused for a plan and set-viewed records the walk", async () => {
    // Act: hunk curation belongs to diff reviews
    const refused = await runCli(home, [
      "session",
      "curate",
      sessionId,
      "--rejections",
      JSON.stringify([{ path: "src/x.txt", hunkIndex: 0 }]),
    ]);

    // Assert
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("only a diff review");

    // Act
    const viewed = cliJson<Thread>(
      await runCli(home, ["session", "set-viewed", sessionId, "plan.md"]),
    );

    // Assert
    expect(viewed.viewedPaths).toEqual(["plan.md"]);
  });

  test("label, branch, switch, navigate, and fork walk the session's tree", async () => {
    // Arrange: a labelled checkpoint, then a comment on a side branch
    const labelled = cliJson<Thread>(await runCli(home, ["session", "label", sessionId, "start"]));
    const start = labelled.history!.tips.main!;

    cliJson<Thread>(await runCli(home, ["session", "branch", sessionId, "alt"]));
    await runCli(home, [
      "session",
      "annotate",
      sessionId,
      "--quote",
      "two phases",
      "--body",
      "Only on alt.",
    ]);

    // Act
    const onMain = cliJson<Thread>(await runCli(home, ["session", "switch", sessionId, "main"]));
    const onAlt = cliJson<Thread>(await runCli(home, ["session", "switch", sessionId, "alt"]));
    const moved = cliJson<Thread>(
      await runCli(home, ["session", "navigate", sessionId, start, "--summary", "left alt"]),
    );
    const fork = cliJson<Thread>(await runCli(home, ["session", "fork", sessionId]));

    // Assert
    expect(labelled.history!.labels[start]).toBe("start");
    expect(onMain.annotations.map((annotation) => annotation.body)).not.toContain("Only on alt.");
    expect(onAlt.annotations.map((annotation) => annotation.body)).toContain("Only on alt.");
    expect(moved.annotations.map((annotation) => annotation.body)).not.toContain("Only on alt.");
    expect(moved.history!.entries.at(-1)).toMatchObject({
      type: "branch-summary",
      text: "left alt",
    });
    expect(fork.id).not.toBe(sessionId);
    expect(fork.parentSessionId).toBe(sessionId);
    expect(fork.status).toBe("pending");
  });

  test("a review-side agent cannot move the tree", async () => {
    // Act
    const refused = await runCli(home, ["session", "branch", sessionId, "mine", "--role", "agent"]);

    // Assert
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/forbidden|owner/i);
  });

  test("actions resolve from the session's repo, not the caller's cwd", async () => {
    // Arrange - a repo whose .cueloop config defines its own quick action
    const repo = mkdtempSync(join(tmpdir(), "cueloop-repo-"));

    mkdirSync(join(repo, ".cueloop"));
    writeFileSync(
      join(repo, ".cueloop", "config.toml"),
      `[[actions]]\nprompt = "Repo special"\nmetadata = "the repo-local system prompt"\n`,
    );
    const scoped = cliJson<Thread>(
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
    const annotated = cliJson<Thread>(
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

  test("--role agent is capped at the daemon: annotate allowed, resolve forbidden", async () => {
    // Arrange
    const capped = cliJson<Thread>(
      await runCli(
        home,
        ["session", "create", "--type", "plan", "--title", "Capped"],
        "# Plan\n\n## Steps\n\nGuard the boundary.\n",
      ),
    );

    // Act - a review-side agent annotates (allowed)
    const annotated = await runCli(home, [
      "session",
      "annotate",
      capped.id,
      "--role",
      "agent",
      "--quote",
      "boundary",
      "--author",
      "SHA256:agent",
      "--body",
      "which boundary?",
    ]);

    // Assert
    expect(annotated.code).toBe(0);

    // Act - the same agent tries to resolve (owner-only)
    const resolved = await runCli(home, [
      "session",
      "send-message",
      capped.id,
      "--role",
      "agent",
      "--outcome",
      "approved",
    ]);

    // Assert - the daemon refuses the escalation
    expect(resolved.code).not.toBe(0);
    expect(resolved.stderr).toContain("cannot call session.sendMessage");
  });

  test("help output and unknown primitives", async () => {
    // Act
    const help = await runCli(home, ["help"]);

    // Assert
    expect(help.stdout).toContain("cueloop session <primitive>");

    // Act
    const bad = await runCli(home, ["session", "frobnicate"]);

    // Assert
    expect(bad.code).toBe(2);
  });
});
