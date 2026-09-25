/**
 * What switching between threads costs: several large threads in one home, the
 * bare shell with the Threads sidebar open, then the cursor clicks each thread
 * title in turn and again on a second lap, each click timed until the painted
 * frame settles. The second lap reopens a thread already visited once, so the
 * median covers both a first open and a return - the case a per-thread
 * projection cache is meant to make cheap.
 */

import { createElement } from "react";
import { App } from "../packages/client/src/App";
import {
  allowEventLoopUpdates,
  clickText,
  isolateUserConfig,
  renderReadyApp,
  waitForText,
} from "../packages/client/src/test-support";
import { HERMETIC_TERMINAL_ENV } from "../test/helpers/env";
import { createTestReviewHome } from "../test/helpers/review-home";
import { createTestGitRepo } from "../test/helpers/git-repo";
import { largePlanMarkdown, manyFilesChange } from "./lib/fixtures";
import { emitLatencyMetrics, emitMemoryMetrics, emitMetric, timeMsAsync } from "./lib/metric";

Object.assign(process.env, HERMETIC_TERMINAL_ENV);

const PLAN_SECTIONS = 48;
const DIFF_FILES = 60;
const DIFF_LINES = 80;
const LAPS = 2;

const repo = createTestGitRepo(manyFilesChange(DIFF_FILES, DIFF_LINES));

try {
  const { patch, files } = await repo.diff();
  const reviewHome = createTestReviewHome();
  const titles = ["Alpha Plan", "Bravo Diff", "Charlie Plan"] as const;

  reviewHome.createPlanSession(largePlanMarkdown(PLAN_SECTIONS), titles[0]);
  reviewHome.createDiffSession(patch, files, titles[1]);
  reviewHome.createPlanSession(largePlanMarkdown(PLAN_SECTIONS), titles[2]);

  const restoreUserConfig = isolateUserConfig(reviewHome.home);

  allowEventLoopUpdates();
  const setup = await renderReadyApp(createElement(App, { home: reviewHome.home }), {
    width: 160,
    height: 40,
  });

  await waitForText(setup, titles[0]);

  const switchMs: number[] = [];

  for (let lap = 0; lap < LAPS; lap++) {
    for (const title of titles) {
      // eslint-disable-next-line no-await-in-loop
      switchMs.push(await timeMsAsync(() => clickText(setup, title)));
    }
  }

  emitMetric("threads", titles.length);
  emitLatencyMetrics("switch", switchMs);
  emitMemoryMetrics("after_switches");

  setup.renderer.destroy();
  restoreUserConfig();
  reviewHome.cleanup();
  process.exit(0);
} finally {
  repo.cleanup();
}
