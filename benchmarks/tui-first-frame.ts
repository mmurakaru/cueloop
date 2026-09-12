/**
 * The TUI in a real pseudo terminal, from spawn to the app's ready signal: a
 * cold launch and a warm one for a plan review. Runs the CLI source through
 * bun, or the compiled binary when CUELOOP_TEST_EXECUTABLE is set, which is
 * the number a user feels. Needs the native shims; without them it reports
 * the tier unavailable and measures nothing.
 */

import { launchTuiSession, ptyTuiAvailable } from "../test/helpers/pty-tui-session";
import { createTestReviewHome } from "../test/helpers/review-home";
import { largePlanMarkdown } from "./lib/fixtures";
import { emitMetric } from "./lib/metric";

/** Tighter than the harness default so a first-frame number is not quantized to 30 ms. */
const READY_POLL_MS = 2;
const READY_TIMEOUT_MS = 30_000;

async function timeToReady(home: string, sessionId: string): Promise<number> {
  const started = performance.now();
  const session = launchTuiSession({ home, args: [sessionId], cols: 140, rows: 40 });

  try {
    await session.waitForReady(READY_TIMEOUT_MS, READY_POLL_MS);

    return performance.now() - started;
  } finally {
    await session.close();
  }
}

if (!ptyTuiAvailable()) {
  emitMetric("is_pty_available", 0);
} else {
  emitMetric("is_pty_available", 1);
  emitMetric("is_compiled_binary", process.env.CUELOOP_TEST_EXECUTABLE ? 1 : 0);
  const reviewHome = createTestReviewHome();

  try {
    const plan = reviewHome.createPlanSession(largePlanMarkdown(32), "Rollout Plan");

    emitMetric("plan_ready_cold_ms", await timeToReady(reviewHome.home, plan.id));
    emitMetric("plan_ready_warm_ms", await timeToReady(reviewHome.home, plan.id));
  } finally {
    reviewHome.cleanup();
  }
}
