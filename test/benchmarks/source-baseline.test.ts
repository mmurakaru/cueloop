import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runTestSourceBaseline(importSource: boolean) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "cueloop-source-baseline-test-")));
  const source = join(directory, "source.ts");
  const frozen = join(directory, "frozen.ts");
  const entry = join(directory, "entry.ts");
  const manifest = join(directory, "manifest.json");

  writeFileSync(source, 'export const sourceValue = "candidate";');
  writeFileSync(frozen, 'export const sourceValue = "baseline";');
  writeFileSync(
    entry,
    importSource
      ? 'import { sourceValue } from "./source.ts"; console.log(sourceValue);'
      : 'console.log("no source import");',
  );
  writeFileSync(manifest, JSON.stringify({ [source]: frozen }));

  try {
    const child = Bun.spawn(
      [
        process.execPath,
        `--preload=${join(import.meta.dir, "../../benchmarks/lib/source-baseline.ts")}`,
        entry,
      ],
      {
        env: { ...process.env, CUELOOP_BENCH_SOURCE_BASELINE: manifest },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return { stdout, stderr, code };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("baseline comparison executes frozen source at the original import path", async () => {
  const result = await runTestSourceBaseline(true);

  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe("baseline");
});

test("an unused baseline override fails instead of comparing candidate to itself", async () => {
  const result = await runTestSourceBaseline(false);

  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Benchmark baseline source was not loaded");
});
