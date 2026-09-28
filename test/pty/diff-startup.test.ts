/** A bare diff launch paints the Changes file list in its first usable frame. */

import { expect } from "bun:test";
import { createTestGitRepo } from "../helpers/git-repo";
import { createTestReviewHome } from "../helpers/review-home";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";

ptyTest("bare diff shows changed files in the Changes tree at ready", async () => {
  const repo = createTestGitRepo([
    {
      path: "src/ready-file.ts",
      before: "export const ready = false;\n",
      after: "export const ready = true;\n",
    },
  ]);
  const reviewHome = createTestReviewHome();
  const session = launchTuiSession({
    home: reviewHome.home,
    cwd: repo.dir,
    args: ["diff"],
    cols: 140,
    rows: 40,
  });

  try {
    await session.waitForReady();
    const treeLines = session
      .text()
      .split("\n")
      .flatMap((line) => {
        const divider = line.lastIndexOf("│");

        return divider >= 0 ? [line.slice(divider + 1)] : [];
      });

    expect(treeLines.some((line) => line.includes("ready-file.ts"))).toBe(true);
  } finally {
    await session.close();
    reviewHome.cleanup();
    repo.cleanup();
  }
});
