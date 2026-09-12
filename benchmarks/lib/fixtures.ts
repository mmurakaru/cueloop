/**
 * Deterministic fixtures for the benchmarks: plans and diffs large enough to
 * cost something, with grep-stable content so a wait can name an exact line.
 * Every generator is pure; the git-backed diffs go through the test repo
 * fixture and the product's own working-tree diff.
 */

import type { TestChangedFile } from "../../test/helpers/git-repo";

/** A plan of `sections` sections, each with a heading, a paragraph, and a bullet list. */
export function largePlanMarkdown(sections: number): string {
  const parts = ["# Rollout Plan", "", "The plan under review, generated for a benchmark.", ""];

  for (let index = 1; index <= sections; index++) {
    parts.push(
      `## Phase ${index}`,
      "",
      `Ship step ${index} behind a flag, watch the error budget, then widen the rollout to the next cohort.`,
      "",
      `- gate ${index}: the dashboard for step ${index} stays green for one hour`,
      `- rollback ${index}: flip the flag off and drain the queue`,
      "",
    );
  }

  return parts.join("\n");
}

/** A plan whose text is wide characters and emoji, so width and wrapping paths run. */
export function wideCharacterPlanMarkdown(sections: number): string {
  const parts = ["# 部署计划 🚀", ""];

  for (let index = 1; index <= sections; index++) {
    parts.push(
      `## 阶段 ${index} ✨`,
      "",
      `第 ${index} 步先在功能开关后面发布，观察错误预算，然后扩大到下一批用户。日本語のテキストも含みます。🎯📈`,
      "",
    );
  }

  return parts.join("\n");
}

/** The source text of one synthetic module, `lines` lines long. */
export function moduleSource(name: string, lines: number, marker: string): string {
  const out: string[] = [];

  for (let line = 1; line <= lines; line++) {
    out.push(`export const ${name}Line${line} = ${line * 100 + marker.length}; // ${marker}`);
  }

  return `${out.join("\n")}\n`;
}

/** `count` small files, each with a few changed lines: the many-files review shape. */
export function manyFilesChange(count: number, linesPerFile: number): TestChangedFile[] {
  const files: TestChangedFile[] = [];

  for (let index = 1; index <= count; index++) {
    const name = `module${index}`;
    const before = moduleSource(name, linesPerFile, "before");
    const after = moduleSource(name, linesPerFile, "after")
      .split("\n")
      .map((line, row) => (row % 7 === 3 ? `${line} // touched` : line))
      .join("\n");

    files.push({ path: `src/${name}.ts`, before, after });
  }

  return files;
}

/** One file of `lines` lines with a change every 50 lines: the single large file shape. */
export function singleLargeFileChange(lines: number): TestChangedFile {
  const before = moduleSource("big", lines, "before");
  const after = before
    .split("\n")
    .map((line, row) => (row % 50 === 25 ? `${line} // edited` : line))
    .join("\n");

  return { path: "src/big.ts", before, after };
}
