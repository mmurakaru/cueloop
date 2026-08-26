/**
 * Diff hot-reload: session.refreshDiff re-captures a diff session's working
 * tree, and the fs watcher drives it on a real change. Exercised against a
 * real temp git repo so the capture path is the production one.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore } from "./api";
import { workingTreeDiff } from "./working-tree";
import { resolveWorkspace } from "./review";
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
    core.sessionResolve(session.id, "approve", "");
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

describe("the fs watcher drives hot-reload", () => {
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
});
