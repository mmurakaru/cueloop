/*
 * The pure geometry behind the trend charts: turn history records into SVG
 * line paths and axis ticks. No `?raw` import and no Astro here, so the root
 * test suite can exercise it directly.
 */

import type { HistoryRecord } from "../../benchmarks/lib/history-record";

export type MetricUnit = "ms" | "bytes";

export interface MetricGroup {
  title: string;
  unit: MetricUnit;
  metrics: string[];
}

export interface ChartLine {
  metric: string;
  color: string;
  /** The `d` attribute of the SVG polyline, empty when the metric has no points. */
  path: string;
  /** The metric's most recent value, or null when it never appears. */
  last: number | null;
}

export interface ChartTick {
  value: number;
  y: number;
}

export interface Chart {
  lines: ChartLine[];
  ticks: ChartTick[];
}

export interface ChartGeometry {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export const CHART_GEOMETRY: ChartGeometry = {
  width: 640,
  height: 160,
  padding: { top: 12, right: 12, bottom: 24, left: 56 },
};

const COLORS = ["#7c6cf0", "#2fa37a", "#d9822b", "#c94f6d"];

export function formatChartValue(value: number, unit: MetricUnit): string {
  return unit === "ms" ? `${value.toFixed(0)} ms` : `${(value / (1024 * 1024)).toFixed(0)} MiB`;
}

/** Build the lines and ticks for one metric group over `records` (oldest first). */
export function buildChart(
  records: HistoryRecord[],
  metrics: string[],
  geometry: ChartGeometry = CHART_GEOMETRY,
): Chart {
  const { width, height, padding } = geometry;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const series = metrics.map((metric) => ({
    metric,
    points: records.flatMap((record, index) => {
      const entry = record.metrics[metric];

      return entry ? [{ index, value: entry[0] }] : [];
    }),
  }));
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));
  const max = Math.max(1, ...values) * 1.1;
  const x = (index: number) =>
    padding.left +
    (records.length <= 1 ? innerWidth / 2 : (index / (records.length - 1)) * innerWidth);
  const y = (value: number) => padding.top + innerHeight - (value / max) * innerHeight;
  const lines: ChartLine[] = series.map((entry, order) => ({
    metric: entry.metric,
    color: COLORS[order % COLORS.length]!,
    path: entry.points
      .map(
        (point, i) =>
          `${i === 0 ? "M" : "L"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`,
      )
      .join(" "),
    last: entry.points.at(-1)?.value ?? null,
  }));
  const ticks: ChartTick[] = [0, 0.5, 1].map((fraction) => ({
    value: max * fraction,
    y: y(max * fraction),
  }));

  return { lines, ticks };
}
