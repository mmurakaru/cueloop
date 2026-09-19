/**
 * Parsing without a screen: plan markdown into blocks, anchors resolved by the
 * exact and the fuzzy tier, and patch text into diff rows for a many-files
 * review and a single very large file. Fast operations run in batches sized
 * to tens of milliseconds, so the timing clears the gate's floor; the round
 * counts describe the batches so a result file is self-explaining.
 */

import { makeAnchor, parseBlocks, resolveAnchor } from "@cueloop/schema";
import { diffRows } from "../packages/client/src/view-diff";
import { createTestGitRepo } from "../test/helpers/git-repo";
import {
  largePlanMarkdown,
  manyFilesChange,
  singleLargeFileChange,
  wideCharacterPlanMarkdown,
} from "./lib/fixtures";
import { emitMetric, timeBatchMs } from "./lib/metric";

const PLAN_SECTIONS = 64;
const PARSE_ROUNDS = 500;
const ANCHOR_ROUNDS = 2_000;
const MANY_FILES = 240;
const LINES_PER_FILE = 48;
const MANY_FILES_ROUNDS = 5;
const LARGE_FILE_LINES = 18_000;
const LARGE_FILE_ROUNDS = 50;

// plan parse
const plan = largePlanMarkdown(PLAN_SECTIONS);
const widePlan = wideCharacterPlanMarkdown(PLAN_SECTIONS);
const blocks = parseBlocks(plan);

emitMetric("plan_blocks", blocks.length);
emitMetric("parse_rounds", PARSE_ROUNDS);
emitMetric(
  "plan_parse_ms",
  timeBatchMs(() => parseBlocks(plan), PARSE_ROUNDS),
);
emitMetric(
  "wide_plan_parse_ms",
  timeBatchMs(() => parseBlocks(widePlan), PARSE_ROUNDS),
);

// anchors: an exact quote resolves on the first tier; an edited block forces the fuzzy tier
const paragraphIndex = blocks.findIndex((block) => block.kind === "p" && block.text.length > 40);
const paragraph = blocks[paragraphIndex]!;
const anchor = makeAnchor(blocks, paragraphIndex, 5, Math.min(paragraph.text.length, 60));
const edited = parseBlocks(plan.replace(paragraph.text, paragraph.text.replace("flag", "switch")));

emitMetric("anchor_rounds", ANCHOR_ROUNDS);
emitMetric(
  "anchor_exact_resolve_ms",
  timeBatchMs(() => resolveAnchor(anchor, blocks), ANCHOR_ROUNDS),
);
emitMetric(
  "anchor_fuzzy_resolve_ms",
  timeBatchMs(() => resolveAnchor(anchor, edited), ANCHOR_ROUNDS),
);

// diff rows from real patches
const manyFiles = createTestGitRepo(manyFilesChange(MANY_FILES, LINES_PER_FILE));
const largeFile = createTestGitRepo([singleLargeFileChange(LARGE_FILE_LINES)]);

try {
  const manyPatch = (await manyFiles.diff()).patch;
  const largePatch = (await largeFile.diff()).patch;

  emitMetric("many_files_patch_bytes", Buffer.byteLength(manyPatch));
  emitMetric("many_files_rounds", MANY_FILES_ROUNDS);
  emitMetric(
    "many_files_diff_rows_ms",
    timeBatchMs(() => diffRows(manyPatch), MANY_FILES_ROUNDS),
  );
  emitMetric("large_file_patch_bytes", Buffer.byteLength(largePatch));
  emitMetric("large_file_rounds", LARGE_FILE_ROUNDS);
  emitMetric(
    "large_file_diff_rows_ms",
    timeBatchMs(() => diffRows(largePatch), LARGE_FILE_ROUNDS),
  );
} finally {
  manyFiles.cleanup();
  largeFile.cleanup();
}
