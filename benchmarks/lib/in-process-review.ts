/**
 * An in-process review for headless benchmarks: a daemon in a temp home, a
 * session, and the App rendered through the test renderer until its ready
 * signal. One review per cold process, which matches the sampler; the script
 * hands its measurements to `runReviewBenchmark`, which owns teardown and the
 * explicit exit a large review needs.
 */

import { createElement } from "react";
import type { DiffFileContents } from "@cueloop/schema";
import { App } from "../../packages/client/src/App";
import {
  allowEventLoopUpdates,
  isolateUserConfig,
  press,
  renderReadyApp,
} from "../../packages/client/src/test-support";
import { HERMETIC_HERDR_ENV } from "../../test/helpers/env";
import { createTestReviewHome, type TestReviewHome } from "../../test/helpers/review-home";
import { timeRepeatedAsync } from "./metric";

// a script run outside the sampler must not reach a developer's live herdr session
Object.assign(process.env, HERMETIC_HERDR_ENV);

/** The rendered App as the test helpers type it, so drivers such as `press` accept it. */
type ReadyAppSetup = Awaited<ReturnType<typeof renderReadyApp>>;
type ReviewSize = Parameters<typeof renderReadyApp>[1];

export interface InProcessReview {
  reviewHome: TestReviewHome;
  setup: ReadyAppSetup;
  /** Milliseconds from render start to the ready signal: the cost of rendering this artifact. */
  renderReadyMs: number;
  cleanup(): void;
}

async function renderReview(
  reviewHome: TestReviewHome,
  sessionId: string,
  size: ReviewSize,
): Promise<InProcessReview> {
  const restoreUserConfig = isolateUserConfig(reviewHome.home);

  allowEventLoopUpdates();
  const started = performance.now();
  const setup = await renderReadyApp(
    createElement(App, { home: reviewHome.home, sessionId }),
    size,
  );
  const renderReadyMs = performance.now() - started;

  return {
    reviewHome,
    setup,
    renderReadyMs,
    cleanup() {
      // a large review keeps highlight work queued long after the metrics are out; tear the renderer down
      setup.renderer.destroy();
      restoreUserConfig();
      reviewHome.cleanup();
    },
  };
}

/** A plan review over `markdown`, ready. */
export function renderPlanReview(markdown: string, size: ReviewSize): Promise<InProcessReview> {
  const reviewHome = createTestReviewHome();
  const session = reviewHome.createPlanSession(markdown, "Benchmark Plan");

  return renderReview(reviewHome, session.id, size);
}

/** A diff review over `patch` and `files`, ready. */
export function renderDiffReview(
  patch: string,
  files: DiffFileContents[],
  size: ReviewSize,
): Promise<InProcessReview> {
  const reviewHome = createTestReviewHome();
  const session = reviewHome.createDiffSession(patch, files);

  return renderReview(reviewHome, session.id, size);
}

/**
 * Milliseconds per press of `key`, each timed until the painted frame settles.
 * Settling costs about 14 ms of harness on its own, so the number is an upper
 * bound on what a user feels; it is comparable between runs, not absolute.
 */
export function timePresses(setup: ReadyAppSetup, key: string, count: number): Promise<number[]> {
  return timeRepeatedAsync(count, () => press(setup, key));
}

/** Run `measure` over a review, tear it down, and exit: the metrics are out and queued renderer work must not hold the process. */
export async function runReviewBenchmark(
  review: Promise<InProcessReview>,
  measure: (review: InProcessReview) => Promise<void>,
): Promise<never> {
  const ready = await review;

  try {
    await measure(ready);
  } finally {
    ready.cleanup();
  }
  process.exit(0);
}
