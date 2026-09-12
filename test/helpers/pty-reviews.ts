/**
 * Ready-to-drive PTY reviews: the tier gate, the shared plan text, and
 * launchers that open a plan or diff session in the TUI and wait for the app's
 * ready signal. Every PTY suite starts from here so the fixtures and the
 * readiness protocol live in one place.
 */

import { test } from "bun:test";
import type { ReviewSession } from "@cueloop/schema";
import { createTestGitRepo, type TestChangedFile, type TestGitRepo } from "./git-repo";
import { launchTuiSession, ptyTuiAvailable, type PtyTuiSession } from "./pty-tui-session";
import type { TestReviewHome } from "./review-home";

/** Whether this process runs the PTY tier: opted in through CUELOOP_RUN_PTY (`bun run test:pty`). */
export const PTY_TIER_ENABLED = !!process.env.CUELOOP_RUN_PTY;

/** `test` when the tier runs, `test.skip` otherwise, so a suite reads the same either way. */
export const ptyTest = PTY_TIER_ENABLED ? test : test.skip;

// An explicitly requested PTY run must not pass by skipping everything.
if (PTY_TIER_ENABLED && !ptyTuiAvailable()) {
  throw new Error(
    "PTY tier requested via CUELOOP_RUN_PTY but the native pty or Ghostty VT shim is missing for this platform",
  );
}

/** A two-phase plan whose last paragraph marks the first full paint. */
export const ROLLOUT_PLAN = `# Rollout Plan

## Phase 1

Ship the daemon behind a flag.

## Phase 2

Enable it for everyone immediately.
`;

/** The last line of ROLLOUT_PLAN; on screen once the plan has painted. */
export const ROLLOUT_PLAN_LAST_LINE = "Enable it for everyone immediately.";

/** The line the appending test editor adds to a plan. */
export const EDIT_MARKER = "Edited via PTY hand-off.";

/** A store class whose diff adds `new Map()`; on screen once the diff has painted. */
export const STORE_CHANGE: TestChangedFile = {
  path: "src/store.ts",
  before: "export class Store {\n  private items = [];\n  count = 0;\n}\n",
  after: "export class Store {\n  private items = new Map();\n  count = 1;\n}\n",
};

/** A one-line second file, so a diff review has two files to walk. */
export const OTHER_CHANGE: TestChangedFile = {
  path: "src/other.ts",
  before: "export const a = 1;\n",
  after: "export const a = 2;\n",
};

export interface LaunchReviewOptions {
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

/** Open ROLLOUT_PLAN in the TUI, ready and painted. */
export async function launchPlanReview(
  reviewHome: TestReviewHome,
  options: LaunchReviewOptions = {},
): Promise<{ session: PtyTuiSession; review: ReviewSession }> {
  const review = reviewHome.createPlanSession(ROLLOUT_PLAN, "Rollout Plan");
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
    env: options.env,
  });

  await session.waitForReady();
  await session.waitForText(ROLLOUT_PLAN_LAST_LINE, { what: "the painted plan" });

  return { session, review };
}

/** Open a diff review over `files` in the TUI, ready, with the caret on the added `new Map()` line. */
export async function launchDiffReview(
  reviewHome: TestReviewHome,
  files: TestChangedFile[],
  options: LaunchReviewOptions = {},
): Promise<{ session: PtyTuiSession; review: ReviewSession; repo: TestGitRepo }> {
  const repo = createTestGitRepo(files);
  const diff = await repo.diff();
  const review = reviewHome.createDiffSession(diff.patch, diff.files);
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: options.cols ?? 160,
    rows: options.rows ?? 40,
    env: options.env,
  });

  await session.waitForReady();
  await session.waitForText("new Map()", { what: "the painted diff" });
  await session.click("new Map()");

  return { session, review, repo };
}
