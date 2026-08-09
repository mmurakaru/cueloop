/** Working-tree diff capture against a real temp git repo. */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "@cueloop/daemon/review";
import { workingTreeDiff } from "../../packages/cli/src/working-tree";

function sh(args: string[], cwd: string): void {
  const gitResult = Bun.spawnSync(args, { cwd, stdout: "ignore", stderr: "ignore" });
  if (gitResult.exitCode !== 0) throw new Error(`${args.join(" ")} failed`);
}

describe("workingTreeDiff", () => {
  test("captures tracked changes and untracked files", () => {
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
        const ws = await resolveWorkspace(repo);
        expect(ws.branch).toBe("main");
        const diff = await workingTreeDiff(repo);
        expect(diff).toContain("-export const a = 1;");
        expect(diff).toContain("+export const a = 2;");
        expect(diff).toContain("+export const b = 1;");
      })();
    } finally {
      // cleanup happens after the async assertions via test runner GC of tmp;
      // still remove eagerly on the sync path
      setTimeout(() => rmSync(repo, { recursive: true, force: true }), 500);
    }
  });
});
