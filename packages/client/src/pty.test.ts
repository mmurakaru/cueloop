import { describe, expect, test } from "bun:test";
import { ptyAvailable, spawn } from "./pty";

// The forkpty shim is a per-platform prebuilt; skip where none ships (e.g. CI
// without the built dylib), exactly as the caller degrades to a herdr split.
const ptyTest = ptyAvailable() ? test : test.skip;

/** Run a child on a PTY, collect its output, and resolve with the exit code. */
function runOnPty(file: string, args: string[]): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const pty = spawn(file, args, { name: "xterm-256color", cols: 80, rows: 24 });
    let output = "";
    const timeout = setTimeout(() => reject(new Error("pty child never exited")), 5000);
    pty.onData((chunk) => {
      output += chunk;
    });
    pty.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      resolve({ output, exitCode });
    });
  });
}

describe("pty", () => {
  ptyTest("streams a child's output and reports its exit code", async () => {
    // Act
    const { output, exitCode } = await runOnPty("sh", ["-c", "printf 'PTY-OK'; exit 7"]);

    // Assert
    expect(output).toContain("PTY-OK");
    expect(exitCode).toBe(7);
  });

  ptyTest("forwards written input to the child", async () => {
    // Arrange - `cat` echoes stdin back through the tty until it closes
    const pty = spawn("cat", [], { name: "xterm-256color", cols: 80, rows: 24 });
    let output = "";
    pty.onData((chunk) => {
      output += chunk;
    });

    // Act
    pty.write("ping\n");
    await new Promise((resolve) => setTimeout(resolve, 200));
    pty.kill();

    // Assert - the tty echoes the written line back
    expect(output).toContain("ping");
  });

  ptyTest("passes env through to the child", async () => {
    // Act
    const { output } = await runOnPty("sh", ["-c", "printf '%s' \"$CUELOOP_PTY_MARKER\""]);

    // Assert - a child with no inherited marker prints nothing for it
    expect(output).not.toContain("marker-value");

    // Act - now inject the marker via env
    const withEnv = await new Promise<string>((resolve, reject) => {
      const pty = spawn("sh", ["-c", "printf '%s' \"$CUELOOP_PTY_MARKER\""], {
        name: "xterm-256color",
        env: { ...process.env, CUELOOP_PTY_MARKER: "marker-value" },
      });
      let out = "";
      const timeout = setTimeout(() => reject(new Error("no exit")), 5000);
      pty.onData((chunk) => {
        out += chunk;
      });
      pty.onExit(() => {
        clearTimeout(timeout);
        resolve(out);
      });
    });

    // Assert
    expect(withEnv).toContain("marker-value");
  });
});
