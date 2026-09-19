/**
 * A diff review of many files: render to ready for 180 files with 120 lines
 * each through the headless renderer, then four caret steps through the
 * sheet, and the memory the review holds afterwards.
 */

import { createTestGitRepo } from "../test/helpers/git-repo";
import { manyFilesChange } from "./lib/fixtures";
import { renderDiffReview, runReviewBenchmark, timePresses } from "./lib/in-process-review";
import { emitLatencyMetrics, emitMemoryMetrics, emitMetric } from "./lib/metric";

const FILES = 180;
const LINES_PER_FILE = 120;
const STEPS = 4;

const repo = createTestGitRepo(manyFilesChange(FILES, LINES_PER_FILE));

try {
  const { patch, files } = await repo.diff();

  emitMetric("files", FILES);
  emitMetric("patch_bytes", Buffer.byteLength(patch));
  await runReviewBenchmark(
    renderDiffReview(patch, files, { width: 160, height: 40 }),
    async (review) => {
      emitMetric("render_ready_ms", review.renderReadyMs);
      emitMemoryMetrics("after_render");
      emitLatencyMetrics("row_step", await timePresses(review.setup, "down", STEPS));
      emitMemoryMetrics("after_steps");
    },
  );
} finally {
  repo.cleanup();
}
