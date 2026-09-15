/**
 * Run one benchmark script under Bun's CPU profiler and print the `.cpuprofile` path to open in
 * speedscope or Chrome DevTools. The iterate-fast loop for a hot path:
 *
 *   bun run benchmarks/profile.ts --script interaction-mouse
 *
 * Needs Bun >= 1.3.0 (older Bun silently ignores --cpu-prof). Profiles land in benchmarks/profiles/.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { profileScript } from "./lib/sampler";

const { values } = parseArgs({
  options: { script: { type: "string" }, out: { type: "string" } },
});

if (values.script === undefined) {
  process.stderr.write("usage: bun run benchmarks/profile.ts --script <name> [--out <dir>]\n");
  process.exit(1);
}

const profileDir = values.out ?? join(import.meta.dir, "profiles");
mkdirSync(profileDir, { recursive: true });

const { metrics, profilePath } = await profileScript(values.script, profileDir);

for (const [name, value] of metrics) process.stdout.write(`METRIC ${name}=${value}\n`);
process.stdout.write(`PROFILE ${profilePath}\n`);
