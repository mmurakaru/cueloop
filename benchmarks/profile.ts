/**
 * Run one benchmark script under Bun's CPU or heap profiler and print the artifact paths. Each run
 * writes a binary profile (open the `.cpuprofile` in speedscope, the `.heapsnapshot` in DevTools) plus
 * a readable `.md` report. The iterate-fast loop for a hot path:
 *
 *   bun run benchmarks/profile.ts --script interaction-mouse           # CPU
 *   bun run benchmarks/profile.ts --script interaction-mouse --heap    # allocations
 *
 * Needs Bun >= 1.3.0 (older Bun silently ignores the flags). Profiles land in benchmarks/profiles/.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { profileScript } from "./lib/sampler";

const { values } = parseArgs({
  options: { script: { type: "string" }, out: { type: "string" }, heap: { type: "boolean" } },
});

if (values.script === undefined) {
  process.stderr.write("usage: bun run benchmarks/profile.ts --script <name> [--heap] [--out <dir>]\n");
  process.exit(1);
}

const profileDir = values.out ?? join(import.meta.dir, "profiles");
mkdirSync(profileDir, { recursive: true });

const { metrics, artifacts } = await profileScript(
  values.script,
  profileDir,
  values.heap === true ? "heap" : "cpu",
);

for (const [name, value] of metrics) process.stdout.write(`METRIC ${name}=${value}\n`);
for (const artifact of artifacts) process.stdout.write(`PROFILE ${artifact}\n`);
