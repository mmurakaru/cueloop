/** Working-tree diff capture against a real temp git repo. */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "@cueloop/daemon/review";
import { workingTreeDiff } from "@cueloop/daemon/working-tree";

function sh(args: string[], cwd: string): void {
  const gitResult = Bun.spawnSync(args, { cwd, stdout: "ignore", stderr: "ignore" });
  if (gitResult.exitCode !== 0) throw new Error(`${args.join(" ")} failed`);
}

describe("workingTreeDiff", () => {
  test("captures tracked changes and untracked files", () => {
    // Arrange
    const repo = mkdtempSync(join(tmpdir(), "cueloop-git-"));
    try {
      sh(["git", "init", "-q", "-b", "main"], repo);
      sh(["git", "config", "user.email", "t@t"], repo);
      sh(["git", "config", "user.name", "t"], repo);
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      sh(["git", "add", "."], repo);
      sh(["git", "commit", "-qm", "init"], repo);
      writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
      writeFileSync(join(repo, "b.ts"), "export const b = 1;\n");

      return (async () => {
        // Act
        const ws = await resolveWorkspace(repo);

        // Assert
        expect(ws.branch).toBe("main");

        // Act
        const diff = await workingTreeDiff(repo);

        // Assert - the patch text
        expect(diff.patch).toContain("-export const a = 1;");
        expect(diff.patch).toContain("+export const a = 2;");
        expect(diff.patch).toContain("+export const b = 1;");

        // Assert - full file contents for a tracked modification
        const modified = diff.files.find((file) => file.path === "a.ts")!;
        expect(modified.oldContents).toBe("export const a = 1;\n");
        expect(modified.newContents).toBe("export const a = 2;\n");

        // Assert - an untracked file carries an empty old side
        const untracked = diff.files.find((file) => file.path === "b.ts")!;
        expect(untracked.oldContents).toBe("");
        expect(untracked.newContents).toBe("export const b = 1;\n");
      })();
    } finally {
      // remove eagerly on the sync path; the async assertions run later via tmp GC
      setTimeout(() => rmSync(repo, { recursive: true, force: true }), 500);
    }
  });

  test("captures new and deleted tracked files as empty sides", () => {
    // Arrange
    const repo = mkdtempSync(join(tmpdir(), "cueloop-git-"));
    try {
      sh(["git", "init", "-q", "-b", "main"], repo);
      sh(["git", "config", "user.email", "t@t"], repo);
      sh(["git", "config", "user.name", "t"], repo);
      writeFileSync(join(repo, "gone.ts"), "old line\n");
      sh(["git", "add", "."], repo);
      sh(["git", "commit", "-qm", "init"], repo);
      unlinkSync(join(repo, "gone.ts"));
      writeFileSync(join(repo, "added.ts"), "fresh\n");
      sh(["git", "add", "added.ts"], repo);

      return (async () => {
        // Act
        const diff = await workingTreeDiff(repo);

        // Assert - deletion keeps its old contents and empties the new side
        const deleted = diff.files.find((file) => file.path === "gone.ts")!;
        expect(deleted.oldContents).toBe("old line\n");
        expect(deleted.newContents).toBe("");

        // Assert - a staged new file empties the old side
        const added = diff.files.find((file) => file.path === "added.ts")!;
        expect(added.oldContents).toBe("");
        expect(added.newContents).toBe("fresh\n");
      })();
    } finally {
      setTimeout(() => rmSync(repo, { recursive: true, force: true }), 500);
    }
  });
});
