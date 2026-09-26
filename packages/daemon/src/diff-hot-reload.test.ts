/**
 * Diff hot-reload: session.refreshDiff re-captures a diff session's working
 * tree, and the fs watcher drives it on a real change. Exercised against a
 * real temp git repo so the capture path is the production one.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore } from "./api";
import { workingTreeDiff } from "./working-tree";
import { resolveWorkspace } from "./thread-review";
import type { Artifact } from "@cueloop/schema";

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });

  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
}

let home: string;
let repo: string;
let core: DaemonCore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-hotreload-home-"));
  repo = mkdtempSync(join(tmpdir(), "cueloop-hotreload-repo-"));
  git(["init", "-q", "-b", "main"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(["add", "."], repo);
  git(["commit", "-qm", "init"], repo);
  core = new DaemonCore(home);
});

afterEach(() => {
  core.dispose();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** Open a diff session over the temp repo's current working tree. */
async function openDiffSession() {
  const workspace = await resolveWorkspace(repo);
  const diff = await workingTreeDiff(repo);
  const artifact: Artifact = { type: "diff", content: diff.patch, files: diff.files, meta: {} };

  return core.sessionCreate({ workspace, artifact });
}

describe("session.refreshDiff", () => {
  test("a JJ rewrite with the same patch records its new commit identity", async () => {
    const init = Bun.spawnSync(["jj", "git", "init", "--colocate", repo], {
      cwd: repo,
      stdout: "ignore",
      stderr: "pipe",
    });

    if (init.exitCode !== 0) throw new Error(init.stderr.toString());
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    const first = await core.repoDiff(repo);
    const workspace = await resolveWorkspace(repo);
    const session = core.sessionCreate({
      workspace,
      artifact: {
        type: "diff",
        content: first.patch,
        files: first.files,
        meta: {
          vcs: "jj",
          vcsChangeId: first.source!.changeId,
          vcsRevisionId: first.source!.revisionId,
        },
      },
    });
    const describe = Bun.spawnSync(["jj", "describe", "-m", "same patch, new commit"], {
      cwd: repo,
      stderr: "pipe",
    });

    if (describe.exitCode !== 0) throw new Error(describe.stderr.toString());
    const result = await core.sessionRefreshDiff(session.id);
    const current = core.sessionGet(session.id);

    expect(result.changed).toBe(false);
    expect(current.revisions).toHaveLength(2);
    expect(current.revisions[0]?.content).toBe(current.revisions[1]?.content);
    expect(current.revisions[0]?.source?.revisionId).toBe(first.source!.revisionId);
    expect(current.revisions[1]?.source?.revisionId).toBe(current.artifact.meta.vcsRevisionId);
    expect(current.revisions[1]?.source?.revisionId).not.toBe(first.source!.revisionId);
  });

  test("a submitted JJ change keeps its prior snapshot when refreshed after a rewrite", async () => {
    const init = Bun.spawnSync(["jj", "git", "init", "--colocate", repo], {
      cwd: repo,
      stdout: "ignore",
      stderr: "pipe",
    });

    if (init.exitCode !== 0) throw new Error(init.stderr.toString());
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    const first = await core.repoDiff(repo);
    const workspace = await resolveWorkspace(repo);
    const session = core.sessionCreate({
      workspace,
      artifact: {
        type: "diff",
        content: first.patch,
        files: first.files,
        meta: {
          vcs: "jj",
          vcsChangeId: first.source!.changeId,
          vcsRevisionId: first.source!.revisionId,
        },
      },
    });

    writeFileSync(join(repo, "a.ts"), "export const a = 3;\n");
    const result = await core.sessionRefreshDiff(session.id);
    const current = core.sessionGet(session.id);

    expect(result.changed).toBe(true);
    expect(current.revisions.map((revision) => revision.content)).toEqual([
      first.patch,
      current.artifact.content,
    ]);
    expect(current.revisions[0]?.source?.revisionId).toBe(first.source!.revisionId);
    expect(current.revisions[0]?.files).toEqual(first.files);
    expect(current.revisions[1]?.source?.revisionId).toBe(current.artifact.meta.vcsRevisionId);
    expect(current.revisions[1]?.files).toEqual(current.artifact.files);
    expect(current.artifact.meta.vcsChangeId).toBe(first.source!.changeId);
    expect(current.artifact.meta.vcsRevisionId).not.toBe(first.source!.revisionId);
    expect(current.artifact.content).toContain("+export const a = 3;");
  });

  test("re-captures the working tree and updates the artifact when the patch changed", async () => {
    // Given an open diff session whose working tree then gains a new change
    const session = await openDiffSession();

    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");

    // When the diff is refreshed
    const result = await core.sessionRefreshDiff(session.id);

    // Then the change is reported and the stored artifact carries the fresh patch and files
    expect(result.changed).toBe(true);
    const refreshed = core.sessionGet(session.id);

    expect(refreshed.artifact.content).toContain("+export const a = 2;");
    const modified = refreshed.artifact.files!.find((file) => file.path === "a.ts")!;

    expect(modified.newContents).toBe("export const a = 2;\n");
  });

  test("reports no change and emits nothing when the working tree is unchanged", async () => {
    // Given an open diff session and a listener for session events
    const session = await openDiffSession();
    const events: string[] = [];

    core.onEvent((event) => events.push(event.event));

    // When the diff is refreshed without any working-tree change
    const result = await core.sessionRefreshDiff(session.id);

    // Then nothing changed and no session.updated event fired
    expect(result.changed).toBe(false);
    expect(events).not.toContain("session.updated");
  });

  test("a changed refresh emits session.updated so attached clients re-fetch", async () => {
    // Given an open diff session, a listener, and a fresh working-tree change
    const session = await openDiffSession();
    const events: string[] = [];

    core.onEvent((event) => events.push(event.event));
    writeFileSync(join(repo, "a.ts"), "export const a = 3;\n");

    // When the diff is refreshed
    await core.sessionRefreshDiff(session.id);

    // Then a session.updated event fired for this session
    expect(events).toContain("session.updated");
  });

  test("a tree move after a refresh keeps the fresh patch", async () => {
    // Given a refreshed diff session
    const session = await openDiffSession();

    writeFileSync(join(repo, "a.ts"), "export const a = 4;\n");
    await core.sessionRefreshDiff(session.id);

    // When the owner branches off and switches back
    core.sessionBranch(session.id, "alt");
    const shown = core.sessionSwitch(session.id, "main");

    // Then the artifact still shows the re-captured working tree, and the history has one revision
    expect(shown.artifact.content).toContain("+export const a = 4;");
    expect(shown.history!.entries.filter((entry) => entry.type === "revision")).toHaveLength(1);
  });

  test("is a no-op for a non-diff (plan) session", async () => {
    // Given a plan session in the same workspace
    const workspace = await resolveWorkspace(repo);
    const plan: Artifact = { type: "plan", content: "# Plan\n\nBody.\n", meta: {} };
    const session = core.sessionCreate({ workspace, artifact: plan });

    // When a refresh is attempted
    const result = await core.sessionRefreshDiff(session.id);

    // Then it reports no change and leaves the plan content untouched
    expect(result.changed).toBe(false);
    expect(core.sessionGet(session.id).artifact.content).toBe("# Plan\n\nBody.\n");
  });

  test("refusing a resolved diff session never mutates it (no revive of a closed review)", async () => {
    // Given a diff session that has been resolved
    const session = await openDiffSession();

    core.sessionSendMessage(session.id, "approved", "");
    const resolvedContent = core.sessionGet(session.id).artifact.content;

    writeFileSync(join(repo, "a.ts"), "export const a = 99;\n");

    // When a refresh is attempted on the resolved session
    // Then it is rejected and the frozen artifact is untouched
    expect(core.sessionRefreshDiff(session.id)).rejects.toThrow(/resolved/);
    expect(core.sessionGet(session.id).artifact.content).toBe(resolvedContent);
  });

  test("overlapping refreshes settle to one coherent artifact without error", async () => {
    // Given a live diff session with a fresh working-tree change
    const session = await openDiffSession();

    writeFileSync(join(repo, "a.ts"), "export const a = 7;\n");

    // When two refreshes run concurrently over the same session
    const [first, second] = await Promise.all([
      core.sessionRefreshDiff(session.id),
      core.sessionRefreshDiff(session.id),
    ]);

    // Then both settle and the stored artifact reflects the current tree exactly
    // once - the generation guard keeps the older capture from regressing it
    expect(first.changed || second.changed).toBe(true);
    expect(core.sessionGet(session.id).artifact.content).toContain("+export const a = 7;");
  });
});

describe("PR review sessions", () => {
  test("refresh re-pulls the PR diff via gh and never clobbers it with the working tree", async () => {
    // Given a stub gh that reports a PR diff distinct from the local working tree
    const ghStub = join(repo, "gh-stub.sh");
    const ghLog = join(repo, "gh-stub.log");

    writeFileSync(
      ghStub,
      `#!/bin/sh
printf '%s\n' "$*" >> '${ghLog}'
case "$2" in
  diff) printf "STUB PR DIFF\\n" ;;
  view) printf '{"baseRefOid":"base-2","headRefOid":"sha-2"}\\n' ;;
esac
`,
    );
    chmodSync(ghStub, 0o755);
    const previousGh = process.env.CUELOOP_GH;

    process.env.CUELOOP_GH = ghStub;

    try {
      // Given a PR review over the same repo root, and a local working-tree change present
      const workspace = await resolveWorkspace(repo);
      const artifact: Artifact = {
        type: "diff",
        content: "OLD PR DIFF\n",
        files: [],
        meta: {
          pr: "1",
          prUrl: "https://github.com/org/repo/pull/1",
          prBaseSha: "base-1",
          prHeadSha: "sha-1",
          prRefreshBaseSha: "base-2",
          prRefreshHeadSha: "sha-2",
        },
      };
      const session = core.sessionCreate({ workspace, artifact });

      writeFileSync(join(repo, "a.ts"), "export const a = 123;\n");

      // When the diff is refreshed
      const result = await core.sessionRefreshDiff(session.id);

      // Then it carries the PR diff from gh, not the local working-tree change
      expect(result.changed).toBe(true);
      const refreshed = core.sessionGet(session.id);

      expect(refreshed.artifact.content).toContain("STUB PR DIFF");
      expect(refreshed.artifact.content).not.toContain("export const a = 123;");
      expect(refreshed.artifact.meta.prBaseSha).toBe("base-2");
      expect(refreshed.artifact.meta.prHeadSha).toBe("sha-2");
      expect(refreshed.artifact.meta.prRefreshBaseSha).toBeUndefined();
      expect(refreshed.artifact.meta.prRefreshHeadSha).toBeUndefined();
      expect(refreshed.revisions.map((revision) => revision.content)).toEqual([
        "OLD PR DIFF\n",
        refreshed.artifact.content,
      ]);
      expect(refreshed.revisions.map((revision) => revision.source?.revisionId)).toEqual([
        "sha-1",
        "sha-2",
      ]);
      expect(refreshed.history!.entries.filter((entry) => entry.type === "revision")).toHaveLength(
        2,
      );
      expect(readFileSync(ghLog, "utf8")).toContain("https://github.com/org/repo/pull/1");
      writeFileSync(ghStub, readFileSync(ghStub, "utf8").replace("sha-2", "sha-3"));
      const samePatch = await core.sessionRefreshDiff(session.id);
      const movedHead = core.sessionGet(session.id);

      expect(samePatch.changed).toBe(false);
      expect(movedHead.revisions).toHaveLength(3);
      expect(movedHead.revisions[2]?.content).toBe(movedHead.revisions[1]?.content);
      expect(movedHead.revisions[2]?.source?.revisionId).toBe("sha-3");
    } finally {
      if (previousGh === undefined) delete process.env.CUELOOP_GH;
      else process.env.CUELOOP_GH = previousGh;
    }
  });
});

describe("the fs watcher drives hot-reload", () => {
  test("a JJ workbench refreshes in place after the working copy changes", async () => {
    git(["status"], repo);
    const init = Bun.spawnSync(["jj", "git", "init", "--colocate", repo], {
      cwd: repo,
      stdout: "ignore",
      stderr: "pipe",
    });

    if (init.exitCode !== 0) throw new Error(init.stderr.toString());
    const session = await core.workbenchSession(repo);

    expect(session.artifact.meta.vcs).toBe("jj");
    writeFileSync(join(repo, "a.ts"), "export const a = 42;\n");
    const deadline = Date.now() + 8_000;
    let current = core.sessionGet(session.id);

    while (!current.artifact.content.includes("+export const a = 42;") && Date.now() < deadline) {
      await Bun.sleep(100);
      current = core.sessionGet(session.id);
    }
    expect(current.artifact.content).toContain("+export const a = 42;");
    expect(current.revisions).toHaveLength(1);
    expect(current.artifact.meta.vcsChangeId).toBeTruthy();
  }, 12_000);

  test("a working-tree change under a live diff session refreshes it in place", async () => {
    // Given a live diff session whose repo the daemon is watching
    const session = await openDiffSession();

    // When a tracked file changes on disk
    writeFileSync(join(repo, "a.ts"), "export const a = 42;\n");

    // Then the watcher debounces and re-captures the diff without any manual call.
    // Watchers can be slow under CI contention, so poll generously.
    const deadline = Date.now() + 8_000;
    let content = core.sessionGet(session.id).artifact.content;

    while (!content.includes("+export const a = 42;") && Date.now() < deadline) {
      await Bun.sleep(100);
      content = core.sessionGet(session.id).artifact.content;
    }
    expect(content).toContain("+export const a = 42;");
  }, 12_000);

  test("watches a directory created after open, so a change inside it refreshes", async () => {
    // Given an open diff session over a repo that had no such directory
    const session = await openDiffSession();

    // When a new directory appears, the watcher extends into it (a recursive watch got this free)
    mkdirSync(join(repo, "pkg"));
    await Bun.sleep(500);
    writeFileSync(join(repo, "pkg", "inside.ts"), "export const inside = 1;\n");

    // Then a change inside the new directory drives a re-capture
    const deadline = Date.now() + 8_000;
    let content = core.sessionGet(session.id).artifact.content;

    while (!content.includes("+export const inside = 1;") && Date.now() < deadline) {
      await Bun.sleep(100);
      content = core.sessionGet(session.id).artifact.content;
    }
    expect(content).toContain("+export const inside = 1;");
  }, 12_000);

  test("a commit refreshes the diff even though no working-tree file changed", async () => {
    // Given an open diff session showing an uncommitted change to a.ts
    writeFileSync(join(repo, "a.ts"), "export const a = 5;\n");
    const session = await openDiffSession();

    expect(core.sessionGet(session.id).artifact.content).toContain("+export const a = 5;");

    // When the change is committed - moving refs/HEAD, touching no working-tree file -
    // the working tree now equals HEAD, so `git diff HEAD` is empty
    git(["add", "a.ts"], repo);
    git(["commit", "-qm", "land a"], repo);

    // Then the git-metadata watch drives a re-capture and the diff empties out
    const deadline = Date.now() + 8_000;
    let content = core.sessionGet(session.id).artifact.content;

    while (content.includes("+export const a = 5;") && Date.now() < deadline) {
      await Bun.sleep(100);
      content = core.sessionGet(session.id).artifact.content;
    }
    expect(content).not.toContain("+export const a = 5;");
  }, 12_000);
});
