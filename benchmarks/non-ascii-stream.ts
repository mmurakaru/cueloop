/**
 * The same render and caret steps as the plan benchmarks, over text made of
 * wide characters and emoji, so cell-width and wrapping paths are measured
 * and not just the ASCII fast path.
 */

import { wideCharacterPlanMarkdown } from "./lib/fixtures";
import { renderPlanReview, runReviewBenchmark, timePresses } from "./lib/in-process-review";
import { emitLatencyMetrics, emitMemoryMetrics, emitMetric } from "./lib/metric";

const PLAN_SECTIONS = 48;
const STEPS = 4;

await runReviewBenchmark(
  renderPlanReview(wideCharacterPlanMarkdown(PLAN_SECTIONS), { width: 100, height: 30 }),
  async (review) => {
    emitMetric("render_ready_ms", review.renderReadyMs);
    emitMemoryMetrics("after_render");
    emitLatencyMetrics("block_step", await timePresses(review.setup, "down", STEPS));
  },
);
