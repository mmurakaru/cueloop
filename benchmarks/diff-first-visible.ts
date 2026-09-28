/** Time from process spawn until a changed file is visible in the real terminal. */

import { launchTuiSession, ptyTuiAvailable } from "../test/helpers/pty-tui-session";
import { createTestGitRepo } from "../test/helpers/git-repo";
import { createTestReviewHome } from "../test/helpers/review-home";
import { emitMetric } from "./lib/metric";

const FILE = "startup-target.ts";
const CHANGED_LINE = "export const value = 2;";
const MANY_FILE_COUNT = 40;
const POLL_MS = 2;
const TIMEOUT_MS = 30_000;

interface VisibilityTiming {
  readyMs: number;
  visibleMs: number;
  visibleAtReady: boolean;
  diffBodyAtReady: boolean;
}

function changedFileVisibleInTree(frame: string, file: string): boolean {
  return frame.split("\n").some((line) => {
    const divider = line.lastIndexOf("│");

    return divider >= 0 && line.slice(divider + 1).includes(file);
  });
}

async function timeToVisible(home: string, cwd: string, file = FILE): Promise<VisibilityTiming> {
  const started = performance.now();
  const session = launchTuiSession({ home, cwd, args: ["diff"], cols: 140, rows: 40 });

  try {
    await session.waitForReady(TIMEOUT_MS, POLL_MS);
    const readyMs = performance.now() - started;
    const readyFrame = session.text();
    const visibleAtReady = changedFileVisibleInTree(readyFrame, file);
    const diffBodyAtReady = readyFrame.includes(CHANGED_LINE);
    const deadline = started + TIMEOUT_MS;

    while (!changedFileVisibleInTree(session.text(), file)) {
      if (performance.now() >= deadline) {
        throw new Error(`Changed file did not appear within ${TIMEOUT_MS}ms:\n${session.text()}`);
      }
      await Bun.sleep(POLL_MS);
    }

    return { readyMs, visibleMs: performance.now() - started, visibleAtReady, diffBodyAtReady };
  } finally {
    await session.close();
  }
}

if (!ptyTuiAvailable()) {
  emitMetric("is_pty_available", 0);
} else {
  emitMetric("is_pty_available", 1);
  emitMetric("is_compiled_binary", process.env.CUELOOP_TEST_EXECUTABLE ? 1 : 0);
  const repo = createTestGitRepo([
    { path: FILE, before: "export const value = 1;\n", after: `${CHANGED_LINE}\n` },
  ]);
  const reviewHome = createTestReviewHome();

  try {
    const newReview = await timeToVisible(reviewHome.home, repo.dir);
    const reopenedReview = await timeToVisible(reviewHome.home, repo.dir);

    emitMetric("diff_first_visible_new_ms", newReview.visibleMs);
    emitMetric("diff_first_visible_reopen_ms", reopenedReview.visibleMs);
    emitMetric("diff_panel_gap_new_ms", Math.max(0, newReview.visibleMs - newReview.readyMs));
    emitMetric(
      "diff_panel_gap_reopen_ms",
      Math.max(0, reopenedReview.visibleMs - reopenedReview.readyMs),
    );
    emitMetric("is_diff_visible_at_ready_new", newReview.visibleAtReady ? 1 : 0);
    emitMetric("is_diff_visible_at_ready_reopen", reopenedReview.visibleAtReady ? 1 : 0);
    emitMetric("is_diff_body_visible_at_ready_new", newReview.diffBodyAtReady ? 1 : 0);
    emitMetric("is_diff_body_visible_at_ready_reopen", reopenedReview.diffBodyAtReady ? 1 : 0);
  } finally {
    reviewHome.cleanup();
    repo.cleanup();
  }

  const manyFiles = createTestGitRepo(
    Array.from({ length: MANY_FILE_COUNT }, (_, index) => ({
      path: `src/file-${String(index).padStart(2, "0")}.ts`,
      before: "export const value = 1;\n",
      after: `${CHANGED_LINE}\n`,
    })),
  );
  const manyFilesHome = createTestReviewHome();

  try {
    const manyFileReview = await timeToVisible(manyFilesHome.home, manyFiles.dir, "file-00.ts");

    emitMetric("diff_first_visible_40_files_ms", manyFileReview.visibleMs);
    emitMetric("is_diff_visible_at_ready_40_files", manyFileReview.visibleAtReady ? 1 : 0);
  } finally {
    manyFilesHome.cleanup();
    manyFiles.cleanup();
  }
}
