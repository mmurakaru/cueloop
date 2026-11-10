import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cliJson, runCli } from "./cli";
import { createTestCliReviewHome } from "./cli-review-home";

test("CLI review home leaves startup to the measured executable", async () => {
  const reviewHome = createTestCliReviewHome();
  const processFile = join(reviewHome.home, "cueloop.pid");

  try {
    expect(existsSync(processFile)).toBe(false);
    const review = await reviewHome.createPlanSession("# Measured plan", "Benchmark plan");
    const daemonProcessId = Number(readFileSync(processFile, "utf8").trim());
    const loaded = await runCli(reviewHome.home, ["session", "get", review.id]);

    expect(daemonProcessId).toBeGreaterThan(0);
    expect(daemonProcessId).not.toBe(process.pid);
    expect(loaded.code).toBe(0);
    expect(cliJson<{ artifact: { content: string } }>(loaded).artifact.content).toBe(
      "# Measured plan",
    );
  } finally {
    await reviewHome.cleanup();
  }

  expect(existsSync(reviewHome.home)).toBe(false);
});

test("an unused CLI review home cleans up without starting a daemon", async () => {
  const reviewHome = createTestCliReviewHome();

  await reviewHome.cleanup();
  expect(existsSync(reviewHome.home)).toBe(false);
});
