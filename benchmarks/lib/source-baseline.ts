/** Load the frozen source files of a performance experiment before application imports. */
import { appendFileSync, readFileSync } from "node:fs";
import * as v from "valibot";

const manifest = process.env.CUELOOP_BENCH_SOURCE_BASELINE;

if (manifest) {
  const replacements = v.parse(
    v.record(v.string(), v.string()),
    JSON.parse(readFileSync(manifest, "utf8")),
  );
  const loaded = new Set<string>();
  const coverage = process.env.CUELOOP_BENCH_SOURCE_COVERAGE;

  process.on("exit", () => {
    if (coverage) {
      for (const path of readFileSync(coverage, "utf8").split("\n")) loaded.add(path);
    }

    const missing = Object.keys(replacements).filter((path) => !loaded.has(path));

    if (missing.length) {
      process.stderr.write(`Benchmark baseline source was not loaded: ${missing.join(", ")}\n`);
      process.exitCode = 1;
    }
  });

  Bun.plugin({
    name: "cueloop-benchmark-source-baseline",
    setup(build) {
      for (const [source, replacement] of Object.entries(replacements)) {
        const filter = new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

        build.onLoad({ filter }, ({ path }) => {
          loaded.add(path);

          if (coverage) appendFileSync(coverage, path + "\n");

          return {
            contents: readFileSync(replacement, "utf8"),
            loader: path.endsWith("tsx") ? "tsx" : "ts",
          };
        });
      }
    },
  });
}
