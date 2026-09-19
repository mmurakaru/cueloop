/**
 * The benchmark history: one JSON line per main push with the commit, the
 * date, and the median and p95 of every gated metric, kept to the newest
 * records. The docs site renders it as trend lines. Written to the
 * `bench-history` branch by CI, never to main.
 *
 *   bun run scripts/benchmarks/history.ts --run results.json --history history.ndjson
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import {
  appendHistory,
  parseHistory,
  serializeHistory,
  type HistoryRecord,
} from "../../benchmarks/lib/history-record";
import { BenchmarkRunSchema, type BenchmarkRun } from "../../benchmarks/lib/result";

/** The record for one run; informational counts are dropped, gated rows kept. */
export function historyRecord(run: BenchmarkRun): HistoryRecord {
  const metrics: HistoryRecord["metrics"] = {};

  for (const result of run.results) {
    if (result.comparable) metrics[result.name] = [result.median, result.p95];
  }
  const record: HistoryRecord = { sha: run.gitSha ?? "unknown", date: run.generatedAt, metrics };

  if (run.packageVersion !== undefined) record.version = run.packageVersion;

  return record;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { run: { type: "string" }, history: { type: "string" } },
  });

  if (!values.run || !values.history) throw new Error("history: --run and --history are required");
  const run = v.parse(BenchmarkRunSchema, await Bun.file(values.run).json());
  const existing = existsSync(values.history)
    ? parseHistory(readFileSync(values.history, "utf8"))
    : [];
  const records = appendHistory(existing, historyRecord(run));

  mkdirSync(dirname(values.history), { recursive: true });
  writeFileSync(values.history, serializeHistory(records));
  console.log(`history: ${records.length} records in ${values.history}`);
}
