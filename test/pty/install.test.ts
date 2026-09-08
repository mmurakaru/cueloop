import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "../../packages/client/src/pty";
import { createTestInstaller } from "../helpers/installer";

const installerPath = join(import.meta.dir, "../../site/public/install.sh");
const terminalTest = process.env.CUELOOP_RUN_PTY ? test : test.skip;

for (const terminalName of ["xterm-256color", "dumb"]) {
  terminalTest(`installer aligns progress in a ${terminalName} terminal`, async () => {
    const { directory, environment, binaryContent } = createTestInstaller();
    let output = "";
    const terminal = spawn("/bin/sh", [installerPath], {
      name: terminalName,
      cols: 160,
      rows: 40,
      cwd: directory,
      env: { ...environment, TERM: terminalName },
    });

    try {
      terminal.onData((chunk) => {
        output += chunk;
      });
      const exitCode = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("installer timed out")), 5000);

        terminal.onExit((event) => {
          clearTimeout(timeout);
          resolve(event.exitCode);
        });
      });
      // eslint-disable-next-line no-control-regex -- Strip terminal styling before checking columns.
      const plainOutput = output.replace(/\x1b\[[0-9;]*[mK]/g, "");

      expect({ exitCode, output: exitCode === 0 ? "" : output }).toEqual({
        exitCode: 0,
        output: "",
      });
      expect(readFileSync(join(directory, "cueloop"), "utf8")).toBe(binaryContent);
      expect(plainOutput).not.toContain("cueloop:");
      expect(plainOutput).toContain("    Run cueloop to get started");
      for (const message of [
        "finding the latest release",
        "downloading",
        "verifying checksum",
        "installing",
      ]) {
        if (terminalName === "dumb") {
          expect(plainOutput).toContain(`    ${message}`);
          expect(output).not.toContain("\r\x1b[K");
        } else {
          expect(plainOutput).toContain(`  ✓ ${message}`);
        }
      }
      if (terminalName !== "dumb") {
        expect(plainOutput).toContain("  cueloop  review surface for coding agents");
        const loadingLines = [
          ...plainOutput.matchAll(/\r(  [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] finding the latest release)/g),
        ];

        expect(loadingLines.length).toBeGreaterThan(0);
        for (const line of loadingLines) {
          expect(Array.from(line[1]!).indexOf("f")).toBe(4);
        }
      }
    } finally {
      terminal.kill();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("installer keeps redirected progress aligned without terminal controls", async () => {
  const { directory, environment, binaryContent } = createTestInstaller();

  try {
    const process = Bun.spawn(["/bin/sh", installerPath], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(process.stderr).text();

    const exitCode = await process.exited;

    expect({ exitCode, output: exitCode === 0 ? "" : output }).toEqual({ exitCode: 0, output: "" });
    expect(output.split("\n").filter(Boolean)).toEqual([
      "    finding the latest release",
      expect.stringMatching(/^    downloading cueloop-.* \(cueloop@test\)$/),
      "    verifying checksum",
      `    installing ${directory}/cueloop`,
      "    Run cueloop to get started",
    ]);
    expect(readFileSync(join(directory, "cueloop"), "utf8")).toBe(binaryContent);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
