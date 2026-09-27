/** Measure completed frames while keyboard selection reaches the edge of each file tree. */

import { createTestGitRepo } from "../test/helpers/git-repo";
import { createTestReviewHome } from "../test/helpers/review-home";
import { launchTuiSession, ptyTuiAvailable } from "../test/helpers/pty-tui-session";
import { emitLatencyMetrics, emitMetric } from "./lib/metric";

const FILES = 40;
const MEASURED_PRESSES = 12;

if (!ptyTuiAvailable()) {
  emitMetric("is_sidebar_scroll_pty_available", 0);
} else {
  emitMetric("is_sidebar_scroll_pty_available", 1);
  const files = [
    { path: "aaa-project-only.ts", before: "same\n", after: "same\n" },
    ...Array.from({ length: FILES }, (_, index) => ({
      path: `file-${String(index).padStart(2, "0")}.ts`,
      before: "old\n",
      after: "new\n",
    })),
  ];
  const repository = createTestGitRepo(files);
  const reviewHome = createTestReviewHome();
  const diff = await repository.diff();
  const review = reviewHome.server.core.sessionCreate({
    workspace: { repoRoot: repository.dir, branch: "main" },
    artifact: {
      type: "diff",
      content: diff.patch,
      files: diff.files,
      meta: { title: "sidebar scroll benchmark" },
    },
  });
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: 110,
    rows: 18,
  });

  async function measure(mode: "changes" | "project", startIndex: number): Promise<void> {
    const paintMs: number[] = [];
    let frames = 0;
    let missingSelectedRows = 0;

    for (const offset of Array.from({ length: MEASURED_PRESSES }, (_, index) => index + 1)) {
      const target = `file-${String(startIndex + offset).padStart(2, "0")}.ts`;

      session.terminalFrames.length = 0;
      session.terminalFrameTimes.length = 0;
      session.captureTerminalFrames = true;
      const started = performance.now();

      // eslint-disable-next-line no-await-in-loop
      await session.press("j");
      session.captureTerminalFrames = false;
      const paintedAt = session.terminalFrames.findIndex((frame) => frame.includes(target));

      if (paintedAt < 0) throw new Error(`${mode}: selected row missing from completed frames`);
      paintMs.push(session.terminalFrameTimes[paintedAt]! - started);
      frames += session.terminalFrames.length;
      missingSelectedRows += Number(!session.text().includes(target));
    }

    emitMetric(`sidebar_${mode}_boundary_presses`, MEASURED_PRESSES);
    emitMetric(`sidebar_${mode}_frames_per_press`, frames / MEASURED_PRESSES);
    emitMetric(`sidebar_${mode}_missing_selected_rows`, missingSelectedRows);
    emitLatencyMetrics(`sidebar_${mode}_row_paint`, paintMs);
  }

  try {
    await session.waitForReady();
    await session.waitForText("file-00.ts");
    await session.clickAt(82, 0);
    for (const key of Array.from({ length: 16 }, () => "j" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    await measure("changes", 16);

    await session.click("project");
    await session.waitForText("aaa-project-only.ts");
    for (const key of Array.from({ length: 17 }, () => "j" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    await measure("project", 16);
  } finally {
    await session.close();
    reviewHome.cleanup();
    repository.cleanup();
  }
}
