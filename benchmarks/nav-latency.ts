/**
 * Click-to-first-byte under a worst-case load: several projects in the sidebar, each holding a large
 * plan thread and a large diff thread, the plans carrying many annotations the thread view must
 * resolve and paint. The harness renders the bare shell with every thread listed, then navigates the
 * way a user does - open a diff, jump to a plan in another project - and times each navigation to the
 * first painted frame that shows its content (the title appears a second time, in the breadcrumb, once
 * the pane paints). The metric is the latency a user feels; the goal is for it to feel instant.
 */

import { createElement } from "react";
import { makeAnchor, parseBlocks } from "@cueloop/schema";
import { App } from "../packages/client/src/App";
import {
  allowEventLoopUpdates,
  isolateUserConfig,
  renderReadyApp,
  waitForText,
} from "../packages/client/src/test-support";
import { HERMETIC_HERDR_ENV } from "../test/helpers/env";
import { createTestReviewHome } from "../test/helpers/review-home";
import { createTestGitRepo } from "../test/helpers/git-repo";
import { largePlanMarkdown, manyFilesChange } from "./lib/fixtures";
import { emitLatencyMetrics, emitMemoryMetrics, emitMetric } from "./lib/metric";
import { timeToFirstPaint } from "./lib/nav-timing";

Object.assign(process.env, HERMETIC_HERDR_ENV);

const PROJECTS = 6;
const PLAN_SECTIONS = 150;
const DIFF_FILES = 80;
const DIFF_LINES = 100;
const ANNOTATIONS_PER_PLAN = 30;

const repo = createTestGitRepo(manyFilesChange(DIFF_FILES, DIFF_LINES));

try {
  const { patch, files } = await repo.diff();
  const reviewHome = createTestReviewHome();
  const planMarkdown = largePlanMarkdown(PLAN_SECTIONS);
  const planBlocks = parseBlocks(planMarkdown);

  interface ThreadRow {
    title: string;
    kind: "plan" | "diff";
  }

  const threads: ThreadRow[] = [];

  for (let project = 0; project < PROJECTS; project++) {
    // distinct rootCommit is what splits the sidebar into project groups (repoRoot is only the label)
    const workspace = {
      repoRoot: `/repo-${project}`,
      branch: "main",
      rootCommit: `rootcommit${project}`,
    };
    const planTitle = `Plan P${project}`;
    const plan = reviewHome.server.core.sessionCreate({
      workspace,
      artifact: { type: "plan", content: planMarkdown, meta: { title: planTitle } },
    });

    for (let index = 0; index < ANNOTATIONS_PER_PLAN; index++) {
      const blockIndex = 1 + ((index * 7) % (planBlocks.length - 1));

      reviewHome.server.core.sessionAnnotate(plan.id, {
        id: `a_${project}_${index}`,
        kind: "comment",
        anchor: makeAnchor(planBlocks, blockIndex, 0, 6),
        body: `note ${index}`,
      });
    }
    threads.push({ title: planTitle, kind: "plan" });

    reviewHome.server.core.sessionCreate({
      workspace,
      artifact: { type: "diff", content: patch, meta: { title: `Diff P${project}` }, files },
    });
    threads.push({ title: `Diff P${project}`, kind: "diff" });
  }

  const restoreUserConfig = isolateUserConfig(reviewHome.home);

  allowEventLoopUpdates();
  const setup = await renderReadyApp(createElement(App, { home: reviewHome.home }), {
    width: 180,
    height: 48,
  });

  await waitForText(setup, threads[0]!.title);

  const planFirstByte: number[] = [];
  const diffFirstByte: number[] = [];
  // the title shows once in the sidebar; a second occurrence is the breadcrumb of the opened pane
  const opened = (title: string) => (frame: string) => frame.split(title).length - 1 >= 2;

  // navigate the way a user does: each thread in turn, twice over, so the metric covers a first open
  // and a return, across projects
  for (let lap = 0; lap < 2; lap++) {
    for (const thread of threads) {
      const frame = setup.captureCharFrame().split("\n");
      const row = frame.findIndex((line) => line.includes(thread.title));

      if (row < 0) continue;
      const x = frame[row]!.indexOf(thread.title) + 1;
      // eslint-disable-next-line no-await-in-loop
      const ms = await timeToFirstPaint(
        setup,
        // delayMs 0: the default click inserts ~30ms of setTimeout delays that would swamp the metric
        () => setup.mockMouse.click(x, row, 0, { delayMs: 0 }),
        opened(thread.title),
      );

      (thread.kind === "plan" ? planFirstByte : diffFirstByte).push(ms);
    }
  }

  emitMetric("projects", PROJECTS);
  emitMetric("threads", threads.length);
  emitLatencyMetrics("plan_first_byte", planFirstByte);
  emitLatencyMetrics("diff_first_byte", diffFirstByte);
  emitMemoryMetrics("after_nav");

  setup.renderer.destroy();
  restoreUserConfig();
  reviewHome.cleanup();
  process.exit(0);
} finally {
  repo.cleanup();
}
