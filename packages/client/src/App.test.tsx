/** Virtual-terminal component tests (tier 2): the real App over a real in-process daemon in a temp home. Char-frame assertions + mock keys - the whole review loop drivable without a terminal. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { isolateUserConfig, press, typeText as type, waitForState, waitForText } from "./test-support";

const PLAN = `# Migration Plan

## Context

The daemon persists sessions to disk atomically.

## Steps

- move the store
- add recovery
`;

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: ReviewSession;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-app-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Migration Plan", planPath: "plan.md" } },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp(sessionId?: string) {
  const setup = await testRender(<App home={home} sessionId={sessionId ?? session.id} />, {
    width: 120,
    height: 32,
  });
  // the async daemon connect + first fetch land within the frame wait
  await waitForText(setup, "cueloop");
  return setup;
}

describe("plan rendering", () => {
  test("renders the plan with headings, list markers, and the rail", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Migration Plan");
    expect(frame).toContain("Context");
    expect(frame).toContain("persists sessions to disk atomically");
    expect(frame).toContain("- move the store");
    expect(frame).toContain("Review (0)");
    expect(frame).toContain("Submit review (0)");
  });
});

describe("keyboard grammar", () => {
  test("j/k moves the cursor glyph between blocks", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await press(setup, "j");
    await press(setup, "j");
    await setup.renderOnce();

    // Assert
    const lines = setup.captureCharFrame().split("\n");
    const cursorLine = lines.find((line) => line.includes("▎"))!;
    expect(cursorLine).toContain("persists sessions");
  });

  test("comment flow: c types a body, ⏎ saves to the daemon", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "c");
    await setup.renderOnce();

    // Assert
    await waitForText(setup, 'comment on "The daemon');

    // Act
    await type(setup, "Define atomically.");
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "COMMENT");
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.body).toBe("Define atomically.");
  });

  test("span mode: v + l selects words, c anchors the exact span", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "v");
    await press(setup, "l"); // "The daemon"
    await press(setup, "c");
    await type(setup, "Which daemon?");
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations[0]!.anchor.quote).toBe("The daemon");
  });

  test("x cuts a block into the working copy; x restores it", async () => {
    // Arrange
    const setup = await renderApp();
    // move to "- move the store" (h1, h2, p, h2 = 4 steps in)
    for (let i = 0; i < 4; i++) await press(setup, "j");

    // Act
    await press(setup, "x");

    // Assert
    await waitForText(setup, "[cut]");
    expect(server.core.sessionGet(session.id).workingCopy).not.toContain("move the store");

    // Act
    await press(setup, "x");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).workingCopy === undefined);
  });

  test("e runs $EDITOR on the working copy and tracks the diff", async () => {
    const script = join(home, "fake-editor.sh");
    await Bun.write(script, `#!/bin/sh\nsed -i '' 's/atomically/very atomically/' "$1"\n`);
    Bun.spawnSync(["chmod", "+x", script]);
    process.env.CUELOOP_EDITOR = script;
    try {
      // Arrange
      const setup = await renderApp();

      // Act
      await press(setup, "e");

      // Assert
      await waitForText(setup, "[edited]");
      expect(server.core.sessionGet(session.id).workingCopy).toContain("very atomically");
    } finally {
      delete process.env.CUELOOP_EDITOR;
    }
  });
});

describe("submit", () => {
  test("⏎ opens the rail confirm card; verdict + summary resolve the session", async () => {
    // Arrange
    const setup = await renderApp();
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "c");
    await type(setup, "Needs a phase list.");
    await press(setup, "enter");
    await waitForText(setup, "Review (1)");

    // Act
    await press(setup, "enter"); // open submit

    // Assert
    await waitForText(setup, "[Changes]");

    // Act
    await type(setup, "Expand the steps.");
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "feedback sent");
    const stored = server.core.sessionGet(session.id);
    expect(stored.status).toBe("resolved");
    expect(stored.verdict!.kind).toBe("request_changes");
    expect(stored.verdict!.feedback).toContain("Needs a phase list.");
    // submit hands the reviewer back to the agent via the completion overlay
    expect(setup.captureCharFrame()).toContain("feedback sent");
  });

  test("approve via ←/→ verdict cycling", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "[Approve]"); // no pending items → approve default

    // Act
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).verdict !== undefined);
    expect(server.core.sessionGet(session.id).verdict!.kind).toBe("approve");
  });
});

describe("inbox", () => {
  test("inbox mode renders and opens a session", async () => {
    // Arrange
    const setup = await testRender(<App home={home} />, { width: 120, height: 32 });
    await waitForText(setup, "inbox");

    // Assert
    expect(setup.captureCharFrame()).toContain("inbox (1 pending)");
    expect(setup.captureCharFrame()).toContain("Migration Plan");

    // Act
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "Submit review (0)");
  });
});
