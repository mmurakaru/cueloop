/**
 * One benchmark history record and the newline-delimited log of them, shared
 * by the CI script that appends records and the docs site that renders them.
 * Dependency-free on purpose: the site bundles this module directly, so it
 * must not reach for valibot or node.
 */

/** The median and p95 of one gated metric, in its unit. */
export type MetricPoint = [median: number, p95: number];

export interface HistoryRecord {
  sha: string;
  date: string;
  version?: string;
  /** metric name to [median, p95] */
  metrics: Record<string, MetricPoint>;
}

/** Records older than this fall off the end of the log. */
export const HISTORY_LIMIT = 500;

function isMetricPoint(value: unknown): value is MetricPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

/** A structural check, so a malformed line is skipped rather than trusted. */
export function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (typeof value !== "object" || value === null) return false;
  if (!("sha" in value) || typeof value.sha !== "string") return false;
  if (!("date" in value) || typeof value.date !== "string") return false;
  if (!("metrics" in value) || typeof value.metrics !== "object" || value.metrics === null) {
    return false;
  }

  return Object.values(value.metrics).every(isMetricPoint);
}

/** The record on one log line, or null when the line is not JSON or not a record. */
function parseLine(line: string): HistoryRecord | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);

    return isHistoryRecord(value) ? value : null;
  } catch {
    // a partial line from an interrupted write; skip it
    return null;
  }
}

/** Every well-formed record in a newline-delimited log, oldest first. */
export function parseHistory(text: string): HistoryRecord[] {
  return text.split("\n").flatMap((line) => {
    const record = parseLine(line);

    return record ? [record] : [];
  });
}

/** Append one record, replacing an earlier record for the same commit, trimmed to the limit. */
export function appendHistory(existing: HistoryRecord[], record: HistoryRecord): HistoryRecord[] {
  return [...existing.filter((candidate) => candidate.sha !== record.sha), record].slice(
    -HISTORY_LIMIT,
  );
}

/** The log text for a list of records, each on its own line. */
export function serializeHistory(records: HistoryRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}
