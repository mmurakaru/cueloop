/**
 * Startup of the compiled binary: `--version` and `--help` wall clock, cold
 * and warm. Needs CUELOOP_TEST_EXECUTABLE (the sampler's --binary); without it
 * the script reports the binary as unavailable and measures nothing, so a
 * source-only run stays honest.
 */

import { hermeticCueloopEnvironment } from "../test/helpers/env";
import { emitMetric, timeMsAsync, timeRepeatedAsync } from "./lib/metric";
import { percentile } from "./lib/result";

const WARM_RUNS = 5;
const home = process.env.CUELOOP_HOME;

if (!home)
  throw new Error("binary-startup: CUELOOP_HOME must name a temp home (the sampler sets it)");

async function runBinary(binary: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([binary, ...args], {
    env: hermeticCueloopEnvironment(home!),
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;

  if (code !== 0) throw new Error(`binary-startup: ${binary} ${args.join(" ")} exited ${code}`);
}

const binary = process.env.CUELOOP_TEST_EXECUTABLE;

if (!binary) {
  emitMetric("is_binary_available", 0);
} else {
  emitMetric("is_binary_available", 1);
  emitMetric("version_cold_ms", await timeMsAsync(() => runBinary(binary, ["--version"])));
  const warm = await timeRepeatedAsync(WARM_RUNS, () => runBinary(binary, ["--version"]));

  emitMetric("version_warm_ms", percentile(warm, 0.5));
  emitMetric("help_ms", await timeMsAsync(() => runBinary(binary, ["--help"])));
}
