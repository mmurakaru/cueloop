/*
 * The benchmark history the trend page renders: one record per push to main,
 * fetched from the bench-history branch at build time into src/data. A build
 * without the file (a preview, a fresh checkout) renders an empty page, never
 * a broken one. The record shape and parser are shared with the CI script that
 * writes the log (benchmarks/lib/history-record.ts).
 */

import { parseHistory, type HistoryRecord } from "../../benchmarks/lib/history-record";
import type { MetricGroup } from "./bench-chart";
import raw from "./data/bench-history.ndjson?raw";

export type { HistoryRecord };

/** Every well-formed record in the fetched log, oldest first. */
export function loadHistory(): HistoryRecord[] {
  return parseHistory(raw);
}

/** The metric groups the page shows, in order, with the metric names that belong to each. */
export const METRIC_GROUPS: MetricGroup[] = [
  {
    title: "Render to ready",
    unit: "ms",
    metrics: [
      "interaction-latency/render_ready_ms",
      "large-stream/render_ready_ms",
      "non-ascii-stream/render_ready_ms",
    ],
  },
  {
    title: "Key press latency",
    unit: "ms",
    metrics: [
      "interaction-latency/nav_press_median_ms",
      "interaction-latency/nav_press_p95_ms",
      "large-stream/row_step_median_ms",
      "non-ascii-stream/block_step_median_ms",
    ],
  },
  {
    title: "Parsing",
    unit: "ms",
    metrics: [
      "artifact-parse/plan_parse_ms",
      "artifact-parse/anchor_fuzzy_resolve_ms",
      "artifact-parse/many_files_diff_rows_ms",
      "artifact-parse/large_file_diff_rows_ms",
    ],
  },
  {
    title: "Daemon",
    unit: "ms",
    metrics: ["daemon-roundtrip/session_create_total_ms", "daemon-roundtrip/session_get_total_ms"],
  },
  {
    title: "Retained memory",
    unit: "bytes",
    metrics: [
      "interaction-latency/after_navigation_heap",
      "large-stream/after_steps_heap",
      "daemon-roundtrip/after_sessions_heap",
    ],
  },
];
