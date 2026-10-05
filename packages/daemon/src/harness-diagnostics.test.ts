import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeHarnessDiagnostic } from "./harness-diagnostics";

test("diagnostic logs are private and bounded across repeated notices", () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-diagnostics-"));
  const path = join(directory, "thread.diagnostics.ndjson");

  try {
    for (let i = 0; i < 100; i++)
      writeHarnessDiagnostic(directory, "thread", {
        kind: "diagnostic",
        severity: "error",
        source: "protocol",
        title: "Advisory",
        text: "x".repeat(32768),
      });
    expect(statSync(path).size).toBeLessThanOrEqual(256 * 1024);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8").trim().split("\n")[0]!).text).toHaveLength(16384);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
