/**
 * The screen wait helpers against a fake reader: they poll until the predicate
 * holds, carry the last screen in the timeout error, fail early on child exit,
 * and never write to the session (a dropped key must stay a failure).
 */

import { describe, expect, test } from "bun:test";
import type { ExitEvent } from "../../packages/client/src/pty";
import { waitForPtyScreen, waitForPtyText, type PtyScreenReader } from "./pty-tui-session";

/** A scripted screen: each `text()` call advances through `frames`, then repeats the last. */
function fakeReader(
  frames: string[],
  exit: ExitEvent | null = null,
): PtyScreenReader & { reads: number } {
  const reader = {
    reads: 0,
    text() {
      const frame = frames[Math.min(reader.reads, frames.length - 1)] ?? "";

      reader.reads += 1;

      return frame;
    },
    exit() {
      return exit;
    },
  };

  return reader;
}

describe("waitForPtyScreen", () => {
  test("returns the first frame the predicate accepts", async () => {
    // Given a screen that paints in three steps
    const reader = fakeReader(["loading", "loading.", "Rollout Plan"]);

    // When waiting for the title
    const screen = await waitForPtyScreen(reader, (frame) => frame.includes("Rollout Plan"));

    // Then the accepted frame comes back after polling past the intermediate ones
    expect(screen).toBe("Rollout Plan");
    expect(reader.reads).toBe(3);
  });

  test("times out with the last screen and the awaited thing in the error", async () => {
    // Given a screen that never changes
    const reader = fakeReader(["stuck on this frame"]);

    // When the deadline passes
    const failure = waitForPtyScreen(reader, () => false, {
      timeoutMs: 80,
      what: "the draft card",
    });

    // Then the error names the wait and quotes the screen
    await expect(failure).rejects.toThrow(
      /PTY screen wait timed out after 80ms waiting for the draft card/,
    );
    await expect(failure).rejects.toThrow(/stuck on this frame/);
  });

  test("fails early when the child has exited", async () => {
    // Given a child that already exited with code 3
    const reader = fakeReader(["goodbye"], { exitCode: 3 });

    // When waiting for text that will never come
    const failure = waitForPtyScreen(reader, () => false, { timeoutMs: 5_000, what: "the plan" });

    // Then the wait does not run to its deadline
    await expect(failure).rejects.toThrow(/PTY child exited with code 3 before the plan/);
  });

  test("an exited child whose final frame already matches still passes", async () => {
    // Given a child that painted the goal and then quit
    const reader = fakeReader(["done"], { exitCode: 0 });

    // When the predicate holds on the first read
    const screen = await waitForPtyScreen(reader, (frame) => frame === "done");

    // Then the exit is not an error
    expect(screen).toBe("done");
  });
});

describe("waitForPtyText", () => {
  test("accepts a substring or a regular expression", async () => {
    // Given a painted footer
    const reader = fakeReader(["  Submit review (n)   q quit"]);

    // When waiting by string and by pattern
    // Then both resolve on the same frame
    await expect(waitForPtyText(reader, "Submit review")).resolves.toContain("Submit review");
    await expect(waitForPtyText(reader, /q\s+quit/)).resolves.toContain("quit");
  });
});
