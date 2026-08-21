/** Claude Code detached wake: against a real autostarted daemon and a fake inbox socket, the waiter parks on a review, posts the verdict on resolve, and no-ops when the session is not messaging-enabled. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { openReview } from "@cueloop/daemon/review";
import { runInboxWake } from "./wake";

const PLAN = "# Wake Plan\n\nShip the daemon behind a flag.\n";

let home: string;
let inboxDir: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cc-wake-"));
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
  if (inboxDir) rmSync(inboxDir, { recursive: true, force: true });
});

function fakeInbox(): { socketPath: string; frames: Promise<string>; stop: () => void } {
  inboxDir = mkdtempSync(join(tmpdir(), "cc-wake-sock-"));
  const socketPath = join(inboxDir, "s.sock");
  let received = "";
  const gotFrames = Promise.withResolvers<string>();
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data: (_socket, data) => {
        received += data.toString();
      },
      close: () => gotFrames.resolve(received),
      open: () => {},
    },
  });
  return { socketPath, frames: gotFrames.promise, stop: () => server.stop() };
}

describe("runInboxWake", () => {
  test("parks on the review, then posts the verdict into the inbox on resolve", async () => {
    // Arrange
    const inbox = fakeInbox();
    const client = await DaemonClient.connect({ home, autostart: true });
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    const waiting = runInboxWake(review.id, {
      home,
      pollMs: 100,
      inbox: { socketPath: inbox.socketPath, token: "tok-1" },
    });

    // Act - the human approves later
    await client.sessionResolve(review.id, "approve", "Looks good.");
    const delivered = await waiting;
    client.close();

    // Assert
    expect(delivered).toBe(true);
    const frames = await inbox.frames;
    expect(frames).toContain('{"type":"auth","token":"tok-1"}');
    const messageLine = frames.trim().split("\n").at(-1)!;
    const content = JSON.parse(messageLine).message.content as string;
    expect(content).toContain("approved");
    expect(content).toContain("# Review: approve");
    expect(content).toContain("Looks good.");
    inbox.stop();
  }, 15_000);

  test("no-op when the session is not messaging-enabled", async () => {
    // Arrange
    const client = await DaemonClient.connect({ home, autostart: true });
    const review = await openReview(client, { type: "plan", content: PLAN, cwd: home });
    client.close();

    // Act - inbox explicitly absent (not a messaging-enabled Claude Code session)
    const delivered = await runInboxWake(review.id, { home, inbox: null });

    // Assert
    expect(delivered).toBe(false);
  });
});
