/** Startup phase timing for the perf harness: records elapsed ms between marks and flushes a
 * labeled block to stderr. Every entry point is a no-op unless the CUELOOP_PERF env var is "1". */

export interface PhaseMark {
  label: string;
  elapsedMs: number;
}

const phaseMarks: PhaseMark[] = [];
let lastMarkAt: number | null = null;

/** Marks record when the stderr timer (CUELOOP_PERF=1) or the kundi exporter (OTEL endpoint) is on. */
function perfInstrumentationEnabled(): boolean {
  return process.env.CUELOOP_PERF === "1" || process.env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined;
}

/** Record the elapsed ms since the previous mark (or process start) under `label`. */
export function perfMark(label: string): void {
  if (!perfInstrumentationEnabled()) return;
  const now = performance.now();
  phaseMarks.push({ label, elapsedMs: now - (lastMarkAt ?? 0) });
  lastMarkAt = now;
}

/** Drain the recorded marks for a reporter to format or export; empties the buffer for the next scope. */
export function takePerfMarks(): PhaseMark[] {
  lastMarkAt = null;

  return phaseMarks.splice(0, phaseMarks.length);
}

/** Render phase deltas as the stderr block: a header, one indented row per mark, a summed TOTAL. */
export function formatPerfBlock(scope: string, marks: readonly PhaseMark[]): string {
  const totalMs = marks.reduce((sum, mark) => sum + mark.elapsedMs, 0);
  const rows = marks.map((mark) => `  ${mark.label}  ${mark.elapsedMs.toFixed(1)}ms`);

  return [`--- perf ${scope} ---`, ...rows, `  TOTAL  ${totalMs.toFixed(1)}ms`, ""].join("\n");
}
