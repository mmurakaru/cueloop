/** Virtual-terminal component tests (tier 2): the real App over a real in-process daemon in a temp home. Char-frame assertions + mock keys - the whole review loop drivable without a terminal. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import {
  clickText,
  dragText,
  frameRow,
  isolateUserConfig,
  locateText,
  press,
  navCommand,
  pressKey,
  renderReadyApp,
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
let session: Thread;

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
  return renderReadyApp(<App home={home} sessionId={sessionId ?? session.id} />, {
    width: 120,
    height: 32,
  });
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
    expect(frame).toContain("Send message (");
  });

  test("a direct open still populates the Threads sidebar with other pending reviews", async () => {
    // Arrange - a second pending review exists alongside the one opened directly
    server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "# Other Plan\n", meta: { title: "Other Plan" } },
    });
    const setup = await renderApp();

    // Act - open the collapsed Threads sidebar (the mirrored panel toggle by the gear)
    await setup.mockMouse.click(4, 0);

    // Assert - the sidebar lists the other pending review, so you can jump to it
    await waitForText(setup, "Other Plan");
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
    await navCommand(setup, "x");

    // Assert - the cut lands in the working copy
    await waitForState(
      setup,
      () => !(server.core.sessionGet(session.id).workingCopy ?? "").includes("move the store"),
    );

    // Act
    await navCommand(setup, "x");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).workingCopy === undefined);
  });

  test("ctrl+e opens the inline editor; the header toggles to normal and leaving tracks the edit", async () => {
    // Arrange
    const setup = await renderApp();

    // Act - open the inline markdown editor over the thread body
    await pressKey(setup, "e", { ctrl: true });

    // Assert - the editor owns the pane (its save hint shows) and the header offers the way back
    await waitForText(setup, "save & close");
    expect(setup.captureCharFrame()).toContain("normal");

    // Act - type into the body, then leave through the header toggle
    await type(setup, "MORE");
    await clickText(setup, "normal");

    // Assert - the edit is tracked into the working copy, and the read-only view is back
    await waitForState(setup, () =>
      (server.core.sessionGet(session.id).workingCopy ?? "").includes("MORE"),
    );
  });
});

describe("submit", () => {
  test("cmd+⏎ opens the rail confirm card; message + summary resolve the session", async () => {
    // Arrange
    const setup = await renderApp();

    await clickText(setup, "daemon");
    await type(setup, "Needs a phase list.");
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "Needs a phase list");

    // Act: with no composer open the same chord opens submit
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the card opens on the default message, approve
    await waitForText(setup, "[Approve]");

    // Act - cycle to request changes, then send with a summary
    await press(setup, "right");
    await waitForText(setup, "[Changes]");
    await type(setup, "Expand the steps.");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "feedback sent");
    const stored = server.core.sessionGet(session.id);

    expect(stored.status).toBe("resolved");
    expect(stored.message!.outcome).toBe("changes_requested");
    expect(stored.message!.body).toContain("Needs a phase list.");
    // submit hands the reviewer back to the agent via the completion overlay
    expect(setup.captureCharFrame()).toContain("feedback sent");
  });

  test("approve via ←/→ message cycling", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "[Approve]"); // no pending items → approve default

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).message !== undefined);
    expect(server.core.sessionGet(session.id).message!.outcome).toBe("approved");
  });
});

describe("no-thread shell", () => {
  test("opening with nothing selected lands in the shell with a Welcome tab and the Threads sidebar", async () => {
    // Arrange
    const setup = await renderReadyApp(<App home={home} />, { width: 120, height: 32 });

    // the Welcome playground measures its width before it paints, so wait for its copy, not the header
    await waitForText(setup, "Getting started");

    // Assert - the same shell header, the disposable Welcome tab, and the pending thread
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Getting started");
    expect(frame).toContain("Migration Plan");
    expect(frame).not.toContain("· resume"); // the bespoke inbox header is retired

    // Act
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "Send message (");
  });

  test("picking a thread from the no-thread shell keeps the Threads sidebar open", async () => {
    // Arrange - a second pending thread so the sidebar has a row that never shows
    // in the opened thread's own view
    server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "# Other Plan\n", meta: { title: "Other Plan" } },
    });
    const setup = await renderReadyApp(<App home={home} />, { width: 120, height: 32 });

    await waitForText(setup, "Getting started");
    await waitForText(setup, "Other Plan"); // the sidebar opens by default here

    // Act - open the thread under the cursor
    await press(setup, "enter");
    await waitForText(setup, "Send message (");

    // Assert - the sidebar stayed open across the swap: both titles are on screen,
    // and the non-opened one can only come from the still-open sidebar
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Migration Plan");
    expect(frame).toContain("Other Plan");
  });

  test("the row kebab menu stars a thread into a Starred section", async () => {
    // Arrange
    const setup = await renderReadyApp(<App home={home} />, { width: 120, height: 32 });

    await waitForText(setup, "Migration Plan");

    // Act - hover the row to reveal its kebab, open the menu, and pick Star
    const row = locateText(setup, "Migration Plan");

    await setup.mockMouse.moveTo(row.column, row.row);
    await waitForText(setup, "⋮");
    await clickText(setup, "⋮");
    // "star" alone collides with "Getting started" in the welcome pane, so target the menu via its
    // unique "rename" row - the star action sits directly above it
    await waitForText(setup, "rename");
    const rename = locateText(setup, "rename");
    await setup.mockMouse.click(rename.column, rename.row - 1);

    // Assert - a Starred section now holds the thread
    await waitForText(setup, "Starred");
    expect(frameRow(setup, "Migration Plan")).toBeGreaterThan(frameRow(setup, "Starred"));
  });

  test("a bare launch shows the Welcome surface with the right region collapsed", async () => {
    // Arrange
    const setup = await renderReadyApp(<App home={home} />, { width: 120, height: 32 });

    await waitForText(setup, "Getting started");

    // Assert - Welcome fills the thread pane (not a Changes tab); the right region stays collapsed
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Getting started");
    expect(frame).not.toContain("Changes"); // the Changes editor is closed on a bare launch
    expect(frame).toContain("Migration Plan"); // the sidebar lists the pending thread
  });

  test("the menu opens from the shell gear and escape is not a trap", async () => {
    // Arrange
    const setup = await renderReadyApp(<App home={home} />, { width: 120, height: 32 });

    await waitForText(setup, "Getting started");

    // Act - open the settings dialog from the top-left gear (the Threads panel header, row 0)
    await setup.mockMouse.click(1, 0);

    // Assert - the settings dialog with its Keybinds leaf appears
    await waitForText(setup, "Keybinds");
    expect(setup.captureCharFrame()).toContain("settings");

    // Act - escape closes the menu (not a trap), and the thread nav still works
    await press(setup, "escape");
    await waitForState(setup, () => !setup.captureCharFrame().includes("Keybinds"));
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "Send message (");
  });
});

describe("the thread view and the menu", () => {
  test("the keybinds dialog lists the thread view grammar, keeps keys away from the text, and closes on escape", async () => {
    // Arrange
    const setup = await renderApp();

    await waitForText(setup, "The daemon persists");

    // Act - open the menu from the top-left settings gear, then the keybinds dialog
    await setup.mockMouse.click(1, 0);
    await waitForText(setup, "Keybinds");
    const dropUp = setup.captureCharFrame().split("\n");
    const keybindsRow = dropUp.findIndex((line) => line.includes("Keybinds"));

    await setup.mockMouse.click(dropUp[keybindsRow]!.indexOf("Keybinds") + 1, keybindsRow);
    await waitForText(setup, "mark text, across blocks");

    // Assert - the thread grammar, not the plan sheet's
    const dialog = setup.captureCharFrame();

    expect(dialog).toContain("nav mode");
    expect(dialog).toContain("place the caret");
    expect(dialog).not.toContain("grow/shrink");

    // Act - a printable behind the dialog must not open a comment; escape closes it
    await press(setup, "x");
    expect(setup.captureCharFrame()).not.toContain("● x");
    await press(setup, "escape");

    // Assert
    await waitForState(setup, () => !setup.captureCharFrame().includes("mark text, across blocks"));
    expect(setup.captureCharFrame()).not.toContain("● x");
  });

  test("clicking the Settings nav group is inert and never corrupts the active category", async () => {
    // Arrange - open the settings dialog from the gear
    const setup = await renderApp();

    await setup.mockMouse.click(1, 0);
    await waitForText(setup, "Keybinds");

    // the nav folder is the last "settings" on screen (the first is the dialog title)
    const lines = setup.captureCharFrame().split("\n");
    let folderRow = -1;
    let folderColumn = -1;

    lines.forEach((line, row) => {
      const column = line.indexOf("settings");

      if (column !== -1) {
        folderColumn = column;
        folderRow = row;
      }
    });

    // Act - click the synthetic Settings group folder, then press a nav key. The
    // key handler dereferences the active category, so a corrupt id would throw
    // (the global key handler swallows the throw into console.error).
    const keyHandlerErrors: string[] = [];
    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => keyHandlerErrors.push(args.map(String).join(" "));
    await setup.mockMouse.click(folderColumn + 1, folderRow);
    await pressKey(setup, "ARROW_DOWN");
    console.error = originalConsoleError;

    // Assert - no key-handler crash, and the dialog is still up
    expect(keyHandlerErrors.filter((line) => line.includes("keypress handler"))).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Keybinds");
  });
});
