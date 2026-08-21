/** Codex queue shell-out: the exact `codex queue --thread <id> --message <text>` argv is passed to the binary (captured by a fake codex), and non-zero exits and a missing binary surface as ok=false. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueCodexMessage } from "./queue";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-queue-"));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * A fake `codex` that records the thread ($3) and message ($5) argv into the cwd
 * and exits 0, or 1 when a `fail` marker file is present in the cwd.
 */
function writeFakeCodex(): string {
  const codexPath = join(tempDir, "codex");
  writeFileSync(
    codexPath,
    [
      "#!/bin/sh",
      'printf "%s" "$3" > thread.txt',
      'printf "%s" "$5" > msg.txt',
      '[ -f fail ] && { echo "the local app-server daemon does not support thread/queue/add" >&2; exit 1; }',
      "exit 0",
    ].join("\n"),
  );
  chmodSync(codexPath, 0o755);
  return codexPath;
}

describe("queueCodexMessage", () => {
  test("passes queue --thread <id> --message <text> and reports ok", async () => {
    // Arrange
    const codexBin = writeFakeCodex();

    // Act
    const result = await queueCodexMessage({
      threadId: "thr_42",
      message: "cueloop review approved - you may proceed.",
      codexBin,
      cwd: tempDir,
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(readFileSync(join(tempDir, "thread.txt"), "utf8")).toBe("thr_42");
    expect(readFileSync(join(tempDir, "msg.txt"), "utf8")).toBe(
      "cueloop review approved - you may proceed.",
    );
  });

  test("a multi-line message survives the argv boundary intact", async () => {
    // Arrange
    const codexBin = writeFakeCodex();
    const message = 'line one\n\nline two with a "quote"';

    // Act
    await queueCodexMessage({ threadId: "t", message, codexBin, cwd: tempDir });

    // Assert
    expect(readFileSync(join(tempDir, "msg.txt"), "utf8")).toBe(message);
  });

  test("a non-zero exit surfaces the stderr tail", async () => {
    // Arrange
    const codexBin = writeFakeCodex();
    writeFileSync(join(tempDir, "fail"), "");

    // Act
    const result = await queueCodexMessage({ threadId: "t", message: "m", codexBin, cwd: tempDir });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.error).toContain("thread/queue/add");
  });

  test("a missing binary is a clean ok=false, not a throw", async () => {
    // Act
    const result = await queueCodexMessage({
      threadId: "t",
      message: "m",
      codexBin: join(tempDir, "does-not-exist"),
      cwd: tempDir,
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
