import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCli } from "./cli";

test("a checkout-relative executable resolves before entering a fixture directory", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-cli-executable-"));
  const binary = join(home, "test-cli");

  writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$1"\n');
  chmodSync(binary, 0o700);

  try {
    const result = await runCli(
      home,
      ["--version"],
      undefined,
      {
        CUELOOP_TEST_EXECUTABLE: relative(process.cwd(), binary),
      },
      home,
    );

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("--version");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
