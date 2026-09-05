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
import {
  clickText,
  dragText,
  frameRow,
  isolateUserConfig,
  press,
  pressKey,
  typeText as type,
  waitForState,
  waitForText,
} from "./test-support";

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
  test("renders the plan with headings, list markers, and the footer", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Migration Plan");
    expect(frame).toContain("Context");
    expect(frame).toContain("persists sessions to disk atomically");
    expect(frame).toContain("· move the store");
    expect(frame).toContain("send message");
  });
});

describe("thread view grammar", () => {
  test("↓ moves the caret between blocks and typing anchors to the block under it", async () => {
    // Arrange
    const setup = await renderApp();

    // Act: two blocks down lands on the paragraph; a printable opens a draft there
    await pressKey(setup, "ARROW_DOWN");
    await pressKey(setup, "ARROW_DOWN");
    await type(setup, "x");

    // Assert: the draft card sits right under the paragraph's row
    await waitForText(setup, "● x");
    expect(frameRow(setup, "● x")).toBeGreaterThan(frameRow(setup, "persists sessions"));
    expect(frameRow(setup, "● x")).toBeLessThan(frameRow(setup, "Steps"));
  });

  test("comment flow: click a word, type a body, cmd+⏎ saves to the daemon", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await clickText(setup, "daemon");
    await type(setup, "Define atomically.");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id);

    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.body).toBe("Define atomically.");
    expect(stored.annotations[0]!.anchor.quote).toBe("daemon");
  });

  test("a drag marks the exact span the comment anchors to", async () => {
    // Arrange
    const setup = await renderApp();

    // Act: from the start of "The" to the end of "daemon"
    await dragText(setup, "The daemon", "daemon persists", "daemon".length);
    await type(setup, "Which daemon?");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.anchor.quote).toBe("The daemon");
  });

  test("option+x cuts the caret's block into the working copy; option+x restores it", async () => {
    // Arrange
    const setup = await renderApp();

    await clickText(setup, "move the store");

    // Act
    await pressKey(setup, "x", { meta: true });

    // Assert - the cut lands in the working copy
    await waitForState(
      setup,
      () => !(server.core.sessionGet(session.id).workingCopy ?? "").includes("move the store"),
    );

    // Act
    await pressKey(setup, "x", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).workingCopy === undefined);
  });

  test("ctrl+e runs $EDITOR on the working copy and tracks the diff", async () => {
    const script = join(home, "fake-editor.sh");

    await Bun.write(script, `#!/bin/sh\nsed -i '' 's/atomically/very atomically/' "$1"\n`);
    Bun.spawnSync(["chmod", "+x", script]);
    process.env.CUELOOP_EDITOR = script;
    try {
      // Arrange
      const setup = await renderApp();

      // Act
      await pressKey(setup, "e", { ctrl: true });

      // Assert
      await waitForText(setup, "[edited]");
      expect(server.core.sessionGet(session.id).workingCopy).toContain("very atomically");
    } finally {
      delete process.env.CUELOOP_EDITOR;
    }
  });
});

describe("submit", () => {
  test("cmd+⏎ opens the rail confirm card; verdict + summary resolve the session", async () => {
    // Arrange
    const setup = await renderApp();

    await clickText(setup, "daemon");
    await type(setup, "Needs a phase list.");
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "Needs a phase list");

    // Act: with no composer open the same chord opens submit
    await pressKey(setup, "RETURN", { meta: true });

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
    await pressKey(setup, "RETURN", { meta: true });

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
  test("inbox mode wears the review header and opens a session", async () => {
    // Arrange
    const setup = await testRender(<App home={home} />, { width: 120, height: 32 });

    await waitForText(setup, "cueloop");

    // Assert - the same header as review, plus the session row
    const frame = setup.captureCharFrame();

    expect(frame).toContain("cueloop · resume");
    expect(frame).toContain("Migration Plan");
    expect(frame).not.toContain("inbox ("); // the old inline header is gone

    // Act
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "send message");
  });

  test("the menu opens from the inbox and escape is not a trap", async () => {
    // Arrange
    const setup = await testRender(<App home={home} />, { width: 120, height: 32 });

    await waitForText(setup, "cueloop · resume");

    // Act - open the drop-down from the top-left settings gear (header content row)
    await setup.mockMouse.click(1, 1);

    // Assert - the drop-up options appear
    await waitForText(setup, "Keybinds");
    expect(setup.captureCharFrame()).toContain("Settings");

    // Act - escape closes the menu (not a trap), and the inbox nav still works
    await press(setup, "escape");
    await waitForState(setup, () => !setup.captureCharFrame().includes("Keybinds"));
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "send message");
  });
});

describe("the thread view and the menu", () => {
  test("the keybinds dialog lists the thread view grammar, keeps keys away from the text, and closes on escape", async () => {
    // Arrange
    const setup = await renderApp();

    await waitForText(setup, "The daemon persists");

    // Act - open the menu from the top-left settings gear, then the keybinds dialog
    await setup.mockMouse.click(1, 1);
    await waitForText(setup, "Keybinds");
    const dropUp = setup.captureCharFrame().split("\n");
    const keybindsRow = dropUp.findIndex((line) => line.includes("Keybinds"));

    await setup.mockMouse.click(dropUp[keybindsRow]!.indexOf("Keybinds") + 1, keybindsRow);
    await waitForText(setup, "mark text, across blocks");

    // Assert - the thread grammar, not the plan sheet's
    const dialog = setup.captureCharFrame();

    expect(dialog).toContain("⌘⌥m");
    expect(dialog).toContain("dismiss an empty draft");
    expect(dialog).not.toContain("grow/shrink");

    // Act - a printable behind the dialog must not open a comment; escape closes it
    await press(setup, "x");
    expect(setup.captureCharFrame()).not.toContain("● x");
    await press(setup, "escape");

    // Assert
    await waitForState(setup, () => !setup.captureCharFrame().includes("dismiss an empty draft"));
    expect(setup.captureCharFrame()).not.toContain("● x");
  });
});
