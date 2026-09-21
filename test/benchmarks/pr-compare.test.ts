/** The sticky PR benchmark comment keeps its status visible and its full table collapsible. */

import { expect, test } from "bun:test";
import { TIMING_THRESHOLD, type Comparison } from "../../scripts/benchmarks/compare";
import { formatPrComment } from "../../scripts/benchmarks/pr-compare";

const comparison: Comparison = {
  baseVersion: "0.1.0-alpha.79",
  headVersion: "0.1.0-alpha.80",
  failed: false,
  rows: [
    {
      name: "a/startup_ms",
      unit: "ms",
      base: 100,
      head: 101,
      delta: 1,
      threshold: TIMING_THRESHOLD,
      status: "pass",
    },
  ],
};
const base = { directory: "/base", sha: "abcdef123" };
const head = { directory: "/head", sha: "123456abc" };

test("PR benchmark comment collapses the table but keeps the status visible", () => {
  const markdown = formatPrComment(comparison, base, head);

  expect(markdown).toContain("<!-- cueloop-bench -->");
  expect(markdown).toContain("## Benchmarks: no material change\n\n<details>");
  expect(markdown).toContain("<summary>View 1 benchmark row</summary>\n\n");
  expect(markdown.indexOf("| metric | base | head |")).toBeGreaterThan(
    markdown.indexOf("<details>"),
  );
  expect(markdown.indexOf("</details>")).toBeGreaterThan(markdown.indexOf("| a/startup_ms |"));
  expect(markdown).toContain("merge base `abcdef1` vs head `123456a`");
});

test("PR benchmark comment keeps a regression warning outside the collapsed table", () => {
  const markdown = formatPrComment(
    { ...comparison, failed: true, rows: [{ ...comparison.rows[0]!, status: "fail" }] },
    base,
    head,
  );

  expect(markdown).toContain("## Benchmarks: 1 row worth a look\n\n<details>");
  expect(markdown).toContain("| fail |");
});
