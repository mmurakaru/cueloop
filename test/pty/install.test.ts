/**
 * The installer's terminal output: spinner frames and check marks on a
 * capable tty, plain indented lines under TERM=dumb and when stderr is piped.
 * Drives the real script in a pseudo terminal against the offline release
 * server. Env-gated behind CUELOOP_RUN_PTY like the rest of the PTY tier; the
 * piped-stderr case needs no tty and runs in the default group too.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "../../packages/client/src/pty";
import {
  GOOD_VERSION,
  startTestReleaseServer,
  testBinaryScript,
  type TestReleaseServer,
} from "../helpers/install-fixtures";
import { ptyTest } from "../helpers/pty-reviews";

const INSTALLER = join(import.meta.dir, "../../site/public/install.sh");

let server: TestReleaseServer;

beforeEach(() => {
  server = startTestReleaseServer();
});

afterEach(() => {
  server.close();
});

for (const terminalName of ["xterm-256color", "dumb"]) {
  ptyTest(`installer aligns progress in a ${terminalName} terminal`, async () => {
    // Arrange - the script on a real tty of the given kind
    let output = "";
    const terminal = spawn("/bin/sh", [INSTALLER], {
      name: terminalName,
      cols: 160,
      rows: 40,
      cwd: server.installDir,
      env: { ...server.environment(), TERM: terminalName },
    });

    terminal.onData((chunk) => {
      output += chunk;
    });

    // Act
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("installer timed out")), 10_000);

      terminal.onExit((event) => {
        clearTimeout(timeout);
        resolve(event.exitCode);
      });
    });
    // eslint-disable-next-line no-control-regex -- strip styling before checking columns
    const plainOutput = output.replace(/\x1b\[[0-9;]*[mK]/g, "");

    // Assert - a clean install, the banner only on a capable tty, and per-terminal progress rendering
    expect(plainOutput).not.toContain("cueloop install failed");
    expect(exitCode).toBe(0);
    expect(readFileSync(server.installedBinary, "utf8")).toBe(testBinaryScript(GOOD_VERSION));
    expect(plainOutput.includes("cueloop  review surface for coding agents")).toBe(
      terminalName !== "dumb",
    );
    expect(plainOutput).toContain("    Then run cueloop to get started");
    for (const message of ["finding the latest release", "verifying checksum"]) {
      if (terminalName === "dumb") {
        expect(plainOutput).toContain(`    ${message}`);
        expect(plainOutput).not.toContain(`  ✓ ${message}`);
      } else {
        expect(plainOutput).toContain(`  ✓ ${message}`);
        // every spinner frame and the final check mark put the message in the same column
        const segments = plainOutput.split(/\r\n?/).filter((segment) => segment.includes(message));

        expect(segments.length).toBeGreaterThan(1);
        for (const segment of segments) expect(segment.indexOf(message)).toBe(4);
      }
    }
    if (terminalName === "dumb") expect(output).not.toContain("\r\x1b[K");
  });
}

test("installer keeps redirected progress aligned without terminal controls", async () => {
  // Arrange - stderr piped, not a tty
  const proc = Bun.spawn(["/bin/sh", INSTALLER], {
    env: server.environment(),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Act
  const output = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Assert - plain four-space lines, one per step, and the PATH hint
  expect(output).not.toContain("cueloop install failed");
  expect(exitCode).toBe(0);
  expect(output.split("\n").filter(Boolean)).toEqual([
    "    finding the latest release",
    expect.stringMatching(/^    downloading cueloop-.* \(cueloop@900\.0\.1\)$/),
    "    verifying checksum",
    `    installing ${server.installDir}/cueloop`,
    `    ${server.installDir} is not on your PATH. Add it:`,
    `    export PATH="${server.installDir}:$PATH"`,
    "    Then run cueloop to get started",
  ]);
  expect(readFileSync(server.installedBinary, "utf8")).toBe(testBinaryScript(GOOD_VERSION));
});
