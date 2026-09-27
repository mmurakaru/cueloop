/** Both right sidebar file trees keep keyboard selection visible in completed terminal frames. */

import { expect } from "bun:test";
import { createTestGitRepo } from "../helpers/git-repo";
import { createTestReviewHome } from "../helpers/review-home";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";

ptyTest("right sidebar changes and project trees reveal keyboard selection", async () => {
  const files = [
    { path: "aaa-project-only.ts", before: "same\n", after: "same\n" },
    ...Array.from({ length: 35 }, (_, index) => ({
      path: `file-${String(index).padStart(2, "0")}.ts`,
      before: "old\n",
      after: "new\n",
    })),
  ];
  const repo = createTestGitRepo(files);
  const reviewHome = createTestReviewHome();
  const diff = await repo.diff();
  const review = reviewHome.server.core.sessionCreate({
    workspace: { repoRoot: repo.dir, branch: "main" },
    artifact: {
      type: "diff",
      content: diff.patch,
      files: diff.files,
      meta: { title: "sidebar scroll" },
    },
  });
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: 110,
    rows: 18,
  });

  try {
    await session.waitForReady();
    await session.waitForText("file-00.ts");
    expect(session.text()).not.toContain("aaa-project-only.ts");
    await session.clickAt(82, 0);
    for (const key of Array.from({ length: 16 }, () => "j" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    expect(session.text()).toContain("file-16.ts");

    session.terminalFrames.length = 0;
    session.captureTerminalFrames = true;
    await session.press("j");
    session.captureTerminalFrames = false;
    expect(session.terminalFrames).toHaveLength(1);
    expect(session.terminalFrames[0]).toContain("file-17.ts");

    await session.click("project");
    await session.waitForText("aaa-project-only.ts");
    for (const key of Array.from({ length: 18 }, () => "j" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    expect(session.text()).toContain("file-17.ts");
  } finally {
    await session.close();
    reviewHome.cleanup();
    repo.cleanup();
  }
});
