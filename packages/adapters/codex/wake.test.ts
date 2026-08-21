/** Codex detached wake: against a real autostarted daemon and a fake codex binary, the waiter parks on a review, then queues the verdict on resolve; a queue failure rejects so a detached run exits non-zero. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { openReview } from "@cueloop/daemon/review";
import { runCodexWake } from "./wake";

const PLAN = "# Codex Wake Plan\n\nShip the daemon behind a flag.\n";

let home: string;
let dir: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "codex-wake-"));
});
afterAll(async () => {
  try {
    const daemonClient = await DaemonClient.connect({ home });
    await daemonClient.shutdown();
    daemonClient.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writeFakeCodex(fail = false): string {
  dir = mkdtempSync(join(tmpdir(), "codex-wake-bin-"));
  const bin = join(dir, "codex");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      'printf "%s" "$3" > thread.txt',
      'printf "%s" "$5" > msg.txt',
      fail ? "exit 1" : "exit 0",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe("runCodexWake", () => {
  test("parks on the review, then queues the verdict into the thread on resolve", async () => {
    // Arrange
    const codexBin = writeFakeCodex();
    const client = await DaemonClient.connect({ home, autostart: true });
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    const waiting = runCodexWake(review.id, "thr_9", { home, pollMs: 100, codexBin, cwd: dir });

    // Act
    await client.sessionResolve(review.id, "request_changes", "Stage it.");
    const delivered = await waiting;
    client.close();

    // Assert
    expect(delivered).toBe(true);
    expect(readFileSync(join(dir, "thread.txt"), "utf8")).toBe("thr_9");
    const message = readFileSync(join(dir, "msg.txt"), "utf8");
    expect(message).toContain("returned changes");
    expect(message).toContain("# Review: request changes");
    expect(message).toContain("Stage it.");
  }, 15_000);

  test("a queue failure rejects so a detached run exits non-zero", async () => {
    // Arrange
    const codexBin = writeFakeCodex(true);
    const client = await DaemonClient.connect({ home, autostart: true });
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    const waiting = runCodexWake(review.id, "thr_x", { home, pollMs: 100, codexBin, cwd: dir });

    // Act
    await client.sessionResolve(review.id, "approve", "ok");
    client.close();

    // Assert
    await expect(waiting).rejects.toThrow("codex queue failed");
  }, 15_000);
});
