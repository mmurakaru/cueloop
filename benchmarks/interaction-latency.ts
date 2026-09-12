/**
 * What a key press costs once the plan is on screen: eight caret moves down a
 * large plan, each timed until the painted frame settles, as median and p95
 * within this process. The sampler then takes the median of those across
 * processes, which separates one slow press from one slow process.
 */

import { largePlanMarkdown } from "./lib/fixtures";
import { renderPlanReview, runReviewBenchmark, timePresses } from "./lib/in-process-review";
import { emitLatencyMetrics, emitMemoryMetrics, emitMetric } from "./lib/metric";

const PLAN_SECTIONS = 64;
const PRESSES = 8;

await runReviewBenchmark(
  renderPlanReview(largePlanMarkdown(PLAN_SECTIONS), { width: 140, height: 40 }),
  async (review) => {
    emitMetric("render_ready_ms", review.renderReadyMs);
    emitMemoryMetrics("after_render");
    emitLatencyMetrics("nav_press", await timePresses(review.setup, "down", PRESSES));
    emitMetric("presses", PRESSES);
    emitMemoryMetrics("after_navigation");
  },
);
