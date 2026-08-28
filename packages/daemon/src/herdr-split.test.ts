/** launchHarnessInSplit: a stubbed herdr binary logs its argv, and the launcher splits the current pane, runs the harness in the new pane, and optionally types the plan-context seed - a no-op outside herdr. */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchHarnessInSplit } from "./herdr-split";

const dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-split-"));

/** A stub herdr binary that logs argv and prints the pane-split result (pane_id of the new split). */
function makeStub(name: string, splitOk = true): { binPath: string; logPath: string } {
  const logPath = join(dir, `${name}.log`);
  const binPath = join(dir, `${name}.sh`);
  const splitResult = splitOk
    ? `printf '{"result":{"pane":{"pane_id":"w1:p9"}}}'`
    : `printf '{"result":{}}'`;

  writeFileSync(
    binPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "pane" ] && [ "$2" = "split" ]; then ${splitResult}; fi
exit 0
`,
  );
  chmodSync(binPath, 0o755);

  return { binPath, logPath };
}

function readLines(logPath: string): string[] {
  if (!existsSync(logPath)) return [];

  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

describe("launchHarnessInSplit", () => {
  test("splits the current pane and runs the harness in the new pane", () => {
    // Arrange
    const stub = makeStub("run");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };

    // Act
    const launched = launchHarnessInSplit({ command: "cc", cwd: "/repo/work" }, env);

    // Assert
    expect(launched).toBeTrue();
    expect(readLines(stub.logPath)).toEqual([
      "pane split w1:p1 --direction right --ratio 0.4 --cwd /repo/work",
      "pane send-text w1:p9 cc",
      "pane send-keys w1:p9 enter",
    ]);
  });

  test("types the plan-context seed into the split after launching", () => {
    // Arrange
    const stub = makeStub("seeded");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };

    // Act
    launchHarnessInSplit({ command: "pi", cwd: "/repo", seedText: "read plan ses_1" }, env);

    // Assert
    expect(readLines(stub.logPath)).toEqual([
      "pane split w1:p1 --direction right --ratio 0.4 --cwd /repo",
      "pane send-text w1:p9 pi",
      "pane send-keys w1:p9 enter",
      "pane send-text w1:p9 read plan ses_1",
    ]);
  });

  test("no-op outside herdr - returns false and spawns nothing", () => {
    // Arrange
    const stub = makeStub("outside");

    // Act
    const launched = launchHarnessInSplit(
      { command: "cc", cwd: "/repo" },
      { HERDR_BIN_PATH: stub.binPath },
    );

    // Assert
    expect(launched).toBeFalse();
    expect(existsSync(stub.logPath)).toBeFalse();
  });

  test("returns false when the split yields no pane id", () => {
    // Arrange
    const stub = makeStub("nopane", false);
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };

    // Act
    const launched = launchHarnessInSplit({ command: "cc", cwd: "/repo" }, env);

    // Assert - the split ran but no harness was launched into a missing pane
    expect(launched).toBeFalse();
    expect(readLines(stub.logPath)).toEqual([
      "pane split w1:p1 --direction right --ratio 0.4 --cwd /repo",
    ]);
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
