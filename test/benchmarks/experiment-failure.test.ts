import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as v from "valibot";

for (const failure of ["warmup", "baseline"] as const) {
  test(`a failed ${failure} replaces previous completed experiment evidence`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "cueloop-experiment-failure-"));
    const output = join(directory, "result.json");

    writeFileSync(output, JSON.stringify({ complete: true }));

    try {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../../benchmarks/paired-experiment.ts"),
          "--script",
          "missing-benchmark-for-failure-test",
          "--pairs",
          "5",
          "--out",
          output,
          ...(failure === "baseline"
            ? [
                "--baseline-ref",
                "missing-baseline-for-failure-test",
                "--file",
                "packages/daemon/src/protocol.ts",
              ]
            : []),
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      const code = await child.exited;
      const result = v.parse(
        v.object({ complete: v.boolean() }),
        JSON.parse(readFileSync(output, "utf8")),
      );

      expect(code).not.toBe(0);
      expect(result.complete).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
