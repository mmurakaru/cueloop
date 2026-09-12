/**
 * A leak check for the long-running daemon: cycle create, use, and delete
 * many times, sample retained heap after a full collection on every cycle,
 * and fit a line through the post-warmup samples. Fails when the total
 * growth or the per-cycle slope exceeds a ceiling. Absolute, not relative to
 * a baseline: a leak is a leak.
 *
 *   bun run scripts/benchmarks/daemon-memory-check.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { largePlanMarkdown } from "../../benchmarks/lib/fixtures";
import { HERMETIC_HERDR_ENV } from "../../test/helpers/env";

const CYCLES = 50;
const WARMUP_CYCLES = 5;
// Local runs settle at well under 1 MiB growth and single-digit KiB/cycle;
// these ceilings leave ample room for runner noise while a real leak, which
// grows on the order of MiB per cycle, trips them at once.
/** Retained heap may not grow more than this over the measured cycles. */
const MAX_GROWTH_BYTES = 24 * 1024 * 1024;
/** Nor faster than this per cycle, on the fitted line. */
const MAX_SLOPE_BYTES_PER_CYCLE = 256 * 1024;

/** Least-squares slope of `samples` against their index, in bytes per cycle. */
export function fitSlope(samples: number[]): number {
  if (samples.length < 2) return 0;
  const count = samples.length;
  const meanIndex = (count - 1) / 2;
  const meanValue = samples.reduce((sum, value) => sum + value, 0) / count;
  let covariance = 0;
  let variance = 0;

  for (const [index, value] of samples.entries()) {
    covariance += (index - meanIndex) * (value - meanValue);
    variance += (index - meanIndex) ** 2;
  }

  return covariance / variance;
}

export interface LeakVerdict {
  growthBytes: number;
  slopeBytesPerCycle: number;
  leaking: boolean;
}

/** Judge post-warmup heap samples against the ceilings. */
export function judgeHeapSamples(samples: number[]): LeakVerdict {
  const growthBytes = (samples.at(-1) ?? 0) - (samples[0] ?? 0);
  const slopeBytesPerCycle = fitSlope(samples);

  return {
    growthBytes,
    slopeBytesPerCycle,
    leaking: growthBytes > MAX_GROWTH_BYTES || slopeBytesPerCycle > MAX_SLOPE_BYTES_PER_CYCLE,
  };
}

function retainedHeapBytes(): number {
  Bun.gc(true);

  return process.memoryUsage().heapUsed;
}

async function cycleDaemon(): Promise<number[]> {
  const home = mkdtempSync(join(tmpdir(), "cueloop-leak-"));
  const server = new DaemonServer({ home, idleExitMs: 0 });

  try {
    if (server.start() === null)
      throw new Error("daemon-memory-check: another daemon owns the temp home");
    const client = await DaemonClient.connect({ home });
    const plan = largePlanMarkdown(16);
    const samples: number[] = [];

    for (let cycle = 0; cycle < WARMUP_CYCLES + CYCLES; cycle++) {
      const session = await client.sessionCreate(
        { repoRoot: "/repo", branch: "main" },
        { type: "plan", content: plan, meta: { title: `Cycle ${cycle}`, planPath: "plan.md" } },
      );

      await client.sessionGet(session.id);
      await client.sessionDelete(session.id);
      if (cycle >= WARMUP_CYCLES) samples.push(retainedHeapBytes());
    }
    client.close();

    return samples;
  } finally {
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  Object.assign(process.env, HERMETIC_HERDR_ENV);
  const samples = await cycleDaemon();
  const verdict = judgeHeapSamples(samples);
  const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

  console.log(
    `daemon-memory-check: ${CYCLES} cycles, heap ${mib(samples[0]!)} -> ${mib(samples.at(-1)!)}, growth ${mib(verdict.growthBytes)}, slope ${(verdict.slopeBytesPerCycle / 1024).toFixed(1)} KiB/cycle`,
  );
  if (verdict.leaking) {
    console.error(
      `daemon-memory-check: FAILED, ceilings are ${mib(MAX_GROWTH_BYTES)} growth and ${MAX_SLOPE_BYTES_PER_CYCLE / 1024} KiB/cycle`,
    );
    process.exit(1);
  }
}
