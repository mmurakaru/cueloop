import { expect, test } from "bun:test";
import { formatPerfBlock } from "./perf-timings";

test("formatPerfBlock renders labeled rows and a summed TOTAL", () => {
  const block = formatPerfBlock("startup", [
    { label: "connect", elapsedMs: 12.34 },
    { label: "firstRender", elapsedMs: 7.66 },
  ]);

  expect(block).toContain("--- perf startup ---");
  expect(block).toContain("connect  12.3ms");
  expect(block).toContain("firstRender  7.7ms");
  expect(block).toContain("TOTAL  20.0ms");
});

test("formatPerfBlock totals to zero for no marks", () => {
  expect(formatPerfBlock("startup", [])).toContain("TOTAL  0.0ms");
});
