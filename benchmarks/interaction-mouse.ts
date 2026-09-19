/**
 * Mouse-driven interaction latency: open a sequence of changed files by clicking their tree rows in
 * a diff review, each timed until the painted frame settles. This is the switch path - opening a file
 * re-derives the session and re-renders the editor. Comparable between runs, not an absolute figure.
 */

import { createTestGitRepo } from "../test/helpers/git-repo";
import { waitForText } from "../packages/client/src/test-support";
import { manyFilesChange } from "./lib/fixtures";
import { renderDiffReview, runReviewBenchmark, timeFileOpens } from "./lib/in-process-review";
import { emitLatencyMetrics, emitMemoryMetrics, emitMetric } from "./lib/metric";

const FILES = 12;
const LINES_PER_FILE = 60;
const OPEN_FILES = ["module2.ts", "module3.ts", "module4.ts", "module5.ts", "module6.ts"];

const repo = createTestGitRepo(manyFilesChange(FILES, LINES_PER_FILE));

try {
  const { patch, files } = await repo.diff();

  emitMetric("files", FILES);
  await runReviewBenchmark(
    renderDiffReview(patch, files, { width: 160, height: 40 }),
    async (review) => {
      emitMetric("render_ready_ms", review.renderReadyMs);
      // the changed-files tree loads after the ready signal; wait until every target row is present
      await waitForText(review.setup, OPEN_FILES[OPEN_FILES.length - 1]!);
      emitMemoryMetrics("after_render");
      emitLatencyMetrics("open_file", await timeFileOpens(review.setup, OPEN_FILES));
      emitMemoryMetrics("after_opens");
    },
  );
} finally {
  repo.cleanup();
}
