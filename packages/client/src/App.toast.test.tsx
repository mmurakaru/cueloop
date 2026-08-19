/** The share toast is non-modal: while it is up, escape still cancels an open overlay. */

import { afterEach, beforeEach, describe, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";

// the controller reaches the gateway through "./share"; stub it so `S` yields a toast
const publishShare = mock(async () => ({ line: "ssh p_share01@cueloop.dev", copied: true }));
mock.module("./share", () => ({
  publishShare,
  pullShare: mock(async () => null),
  pushShare: mock(async () => {}),
  shareIdFromLine: (line: string) => line.match(/^ssh (\S+)@/)?.[1],
  collaboratorAnnotations: () => [],
}));

const { App } = await import("./App");
const { isolateUserConfig, press, waitForText, waitForTextGone } = await import("./test-support");

const PLAN = `# Migration Plan\n\n## Context\n\nThe daemon persists sessions to disk atomically.\n`;

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: ReviewSession;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-toast-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "plan",
      content: PLAN,
      meta: { title: "Migration Plan", planPath: "plan.md" },
    },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("share toast", () => {
  test("escape cancels an open composer even while the toast is up", async () => {
    // Arrange
    const setup = await testRender(<App home={home} sessionId={session.id} />, {
      width: 120,
      height: 32,
    });
    await waitForText(setup, "cueloop");

    // Act: share raises the toast, then open a composer under it
    await press(setup, "S");
    await waitForText(setup, "share link copied");
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "c");
    await waitForText(setup, 'comment on "');

    // Act: escape must reach the composer, not get eaten by the toast
    await press(setup, "escape");

    // Assert: the composer closed on the first escape
    await waitForTextGone(setup, 'comment on "');
  });
});
