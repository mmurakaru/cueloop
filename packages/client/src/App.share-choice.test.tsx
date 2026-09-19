/** The share shortcut opens an app-level public/private choice reachable from any view. */

import { afterEach, beforeEach, describe, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import type { ShareTransport } from "./thread-controller";
import { isolateUserConfig, press, pressKey, waitForText, waitForTextGone } from "./test-support";

const shareTransport: ShareTransport = {
  publish: mock(async () => ({ line: "ssh p_share01@cueloop.dev", copied: true })),
  pull: mock(async () => {
    throw new Error("Unexpected share pull");
  }),
  push: mock(async () => {}),
  watch: () => () => {},
  revoke: async () => {},
  parseShareId: (line) => line.match(/^ssh (\S+)@/)?.[1],
  collaboratorAnnotations: () => [],
  mergeFromShare: () => ({ annotations: [] }),
};

const PLAN = `# Migration Plan\n\n## Context\n\nThe daemon persists sessions to disk atomically.\n`;

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: Thread;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-share-choice-"));
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

describe("share choice", () => {
  test("the shortcut opens the public/private choice", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act
    await pressKey(setup, "s", { ctrl: true });

    // Assert
    await waitForText(setup, "public link");
    await waitForText(setup, "private link");
  });

  test("the private choice opens the manage-access surface", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act: open the choice, move to private, select it
    await pressKey(setup, "s", { ctrl: true });
    await waitForText(setup, "private link");
    await press(setup, "down");
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "manage access");
  });

  test("escape cancels the choice without sharing", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act
    await pressKey(setup, "s", { ctrl: true });
    await waitForText(setup, "public link");
    await press(setup, "escape");

    // Assert
    await waitForTextGone(setup, "public link");
  });
});
