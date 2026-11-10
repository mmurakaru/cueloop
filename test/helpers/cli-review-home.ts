import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { runCli } from "./cli";

const CreatedReviewSchema = v.object({ id: v.string() });

// Release benchmarks must seed and stop the daemon with the binary being measured.
export function createTestCliReviewHome() {
  const home = mkdtempSync(join(tmpdir(), "cueloop-cli-review-home-"));

  async function createSession(type: "plan" | "diff", content: string, title: string, cwd = home) {
    const result = await runCli(
      home,
      ["session", "create", "--type", type, "--title", title],
      content,
      undefined,
      cwd,
    );

    if (result.code !== 0) {
      throw new Error(`CLI review fixture creation failed: ${result.stderr}`);
    }

    return v.parse(CreatedReviewSchema, JSON.parse(result.stdout));
  }

  return {
    home,
    createPlanSession(markdown: string, title = "Plan") {
      return createSession("plan", markdown, title);
    },
    createDiffSession(patch: string, title = "working tree", cwd = home) {
      return createSession("diff", patch, title, cwd);
    },
    async cleanup() {
      const result = await runCli(home, ["stop"]);

      if (result.code !== 0) {
        throw new Error(`CLI review fixture shutdown failed: ${result.stderr || result.stdout}`);
      }

      rmSync(home, { recursive: true, force: true });
    },
  };
}
