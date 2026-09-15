/** Startup phase timing for the perf harness: records elapsed ms between marks and flushes a
 * labeled block to stderr. Every entry point is a no-op unless the CUELOOP_PERF env var is "1". */

export interface PhaseMark {
  label: string;
  elapsedMs: number;
}

const phaseMarks: PhaseMark[] = [];
let lastMarkAt: number | null = null;

function perfTimingEnabled(): boolean {
  return process.env.CUELOOP_PERF === "1";
}

/** Record the elapsed ms since the previous mark (or process start) under `label`. */
export function perfMark(label: string): void {
  if (!perfTimingEnabled()) return;
  const now = performance.now();
  phaseMarks.push({ label, elapsedMs: now - (lastMarkAt ?? 0) });
  lastMarkAt = now;
}

/** Render phase deltas as the stderr block: a header, one indented row per mark, a summed TOTAL. */
export function formatPerfBlock(scope: string, marks: readonly PhaseMark[]): string {
  const totalMs = marks.reduce((sum, mark) => sum + mark.elapsedMs, 0);
  const rows = marks.map((mark) => `  ${mark.label}  ${mark.elapsedMs.toFixed(1)}ms`);

  return [`--- perf ${scope} ---`, ...rows, `  TOTAL  ${totalMs.toFixed(1)}ms`, ""].join("\n");
}

/** Write the recorded phase deltas for `scope` to stderr, then reset for the next scope. */
export function flushPerfTimings(scope: string): void {
  if (!perfTimingEnabled() || phaseMarks.length === 0) return;
  process.stderr.write(formatPerfBlock(scope, phaseMarks));
  phaseMarks.length = 0;
  lastMarkAt = null;
}
