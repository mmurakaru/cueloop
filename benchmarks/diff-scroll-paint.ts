/** Measure when a real terminal paints the caret and newly revealed diff rows. */

import { createTestReviewHome } from "../test/helpers/review-home";
import { launchTuiSession, ptyTuiAvailable } from "../test/helpers/pty-tui-session";
import { emitLatencyMetrics, emitMetric } from "./lib/metric";

const LINES = 160;
const WARMUP_PRESSES = 18;
const MEASURED_PRESSES = 30;
const BURST_PRESSES = 70;
const BURST_GAP_MS = 5;

function caretLine(screen: string): string {
  const line = screen.split("\n").find((candidate) => candidate.includes("▎"));

  if (!line || !/row\d{3} text/.test(line)) throw new Error("diff scroll caret row missing");

  return line;
}

function incompleteRows(frame: string): number {
  let count = 0;

  for (const line of frame.split("\n")) {
    if (/row\d{3} text/.test(line) && !/\d+\s+\+\s+row\d{3} text/.test(line)) count++;
    if (/\d+\s+\+\s*$/.test(line)) count++;
  }

  return count;
}

function visibleRows(frame: string): number {
  return frame.match(/row\d{3} text/g)?.length ?? 0;
}

if (!ptyTuiAvailable()) {
  emitMetric("is_diff_scroll_pty_available", 0);
} else {
  emitMetric("is_diff_scroll_pty_available", 1);
  const reviewHome = createTestReviewHome();
  const added = Array.from(
    { length: LINES },
    (_, index) => `+row${String(index).padStart(3, "0")} text`,
  );
  const patch = [
    "diff --git a/scroll.txt b/scroll.txt",
    "--- a/scroll.txt",
    "+++ b/scroll.txt",
    `@@ -0,0 +1,${LINES} @@`,
    ...added,
    "",
  ].join("\n");
  const review = reviewHome.createDiffSession(patch);
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: 90,
    rows: 18,
  });

  try {
    await session.waitForReady();
    await session.waitForText("row000");
    for (const key of Array.from({ length: WARMUP_PRESSES }, () => "down" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    const expectedVisibleRows = visibleRows(session.text());

    if (expectedVisibleRows < 5) throw new Error("diff scroll viewport did not fill with rows");

    const paintMs: number[] = [];
    let completedFrames = 0;
    let multiFrameSteps = 0;
    let staleCaretFrames = 0;
    let incompleteCaretFrames = 0;
    let incomplete = 0;
    let missingVisibleRows = 0;

    for (const key of Array.from({ length: MEASURED_PRESSES }, () => "down" as const)) {
      session.terminalFrames.length = 0;
      session.terminalFrameTimes.length = 0;
      session.captureTerminalFrames = true;
      const started = performance.now();

      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
      session.captureTerminalFrames = false;
      const target = caretLine(session.text());
      const paintedAt = session.terminalFrames.findIndex((frame) => frame.includes(target));

      if (paintedAt < 0) throw new Error("caret row did not appear in a completed terminal frame");
      paintMs.push(session.terminalFrameTimes[paintedAt]! - started);
      completedFrames += session.terminalFrames.length;
      multiFrameSteps += Number(session.terminalFrames.length > 1);
      for (const frame of session.terminalFrames) {
        const markers = frame.split("\n").filter((line) => line.includes("▎"));

        staleCaretFrames += Number(markers.length === 1 && markers[0] !== target);
        incompleteCaretFrames += Number(markers.length !== 1 || !/row\d{3} text/.test(markers[0]!));
        incomplete += incompleteRows(frame);
        missingVisibleRows += Math.max(0, expectedVisibleRows - visibleRows(frame));
      }
    }

    session.terminalFrames.length = 0;
    session.terminalFrameTimes.length = 0;
    let fastColorSamples = 0;
    let fastColorMismatches = 0;
    let fastFaintCells = 0;

    session.onTerminalFrame = (frame, cellAt) => {
      const rows = frame.split("\n").flatMap((line, y) => {
        const match = /(\d+)\s+\+\s+(row\d{3} text)/.exec(line);

        return match ? [{ y, numberX: match.index, textX: line.indexOf(match[2]!) + 7 }] : [];
      });
      const current = rows.at(-1);
      const previous = rows.at(-2);

      if (!current || !previous) return;
      for (const xOf of ["numberX", "textX"] as const) {
        const edge = cellAt(current[xOf], current.y);
        const reference = cellAt(previous[xOf], previous.y);

        if (!edge || !reference) continue;
        fastColorSamples++;
        fastColorMismatches += Number(
          JSON.stringify(edge.fg) !== JSON.stringify(reference.fg) ||
            JSON.stringify(edge.bg) !== JSON.stringify(reference.bg),
        );
        fastFaintCells += Number(edge.faint);
      }
    };
    session.captureTerminalFrames = true;
    for (const key of Array.from({ length: BURST_PRESSES }, () => "\x1b[B")) {
      session.writeRaw(key);
      // eslint-disable-next-line no-await-in-loop
      await Bun.sleep(BURST_GAP_MS);
    }
    await session.waitIdle(100, 5000);
    session.captureTerminalFrames = false;
    session.onTerminalFrame = undefined;

    emitMetric("diff_scroll_boundary_presses", MEASURED_PRESSES);
    emitMetric("diff_scroll_boundary_frames_per_press", completedFrames / MEASURED_PRESSES);
    emitMetric("diff_scroll_boundary_multi_frame_steps", multiFrameSteps);
    emitMetric("diff_scroll_boundary_stale_caret_frames", staleCaretFrames);
    emitMetric("diff_scroll_boundary_incomplete_caret_frames", incompleteCaretFrames);
    emitMetric("diff_scroll_boundary_incomplete_rows", incomplete);
    emitMetric("diff_scroll_boundary_missing_visible_rows", missingVisibleRows);
    emitLatencyMetrics("diff_scroll_row_paint", paintMs);
    emitMetric("diff_scroll_fast_presses", BURST_PRESSES);
    emitMetric("diff_scroll_fast_frames", session.terminalFrames.length);
    emitMetric("diff_scroll_fast_edge_color_samples", fastColorSamples);
    emitMetric("diff_scroll_fast_edge_color_mismatches", fastColorMismatches);
    emitMetric("diff_scroll_fast_edge_faint_cells", fastFaintCells);
    emitMetric(
      "diff_scroll_fast_incomplete_rows",
      session.terminalFrames.reduce((total, frame) => total + incompleteRows(frame), 0),
    );
    emitMetric(
      "diff_scroll_fast_missing_visible_rows",
      session.terminalFrames.reduce(
        (total, frame) => total + Math.max(0, expectedVisibleRows - visibleRows(frame)),
        0,
      ),
    );
  } finally {
    await session.close();
    reviewHome.cleanup();
  }
}
