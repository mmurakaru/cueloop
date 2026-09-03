/**
 * The rail's Tree tab over the real App and an in-process daemon: the option
 * chords and the mouse reach the same primitives, the pane paints the path,
 * the tips, and the checkpoints, and the thread view shows a moved path in the
 * frame after the key.
 */

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
  isolateUserConfig,
  press,
  pressKey,
  typeText as type,
  waitForState,
  waitForText,
  waitForTextGone,
} from "./test-support";

const PLAN = `# Migration Plan

## Context

The daemon persists sessions to disk atomically.

## Steps

- move the store
- add recovery
`;

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-tree-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "plan",
      content: PLAN,
      meta: { title: "Migration Plan", planPath: "plan.md", agent: "agent/worker-3" },
    },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp(role: "owner" | "collaborator" = "owner") {
  const setup = await testRender(<App home={home} sessionId={session.id} role={role} />, {
    width: 120,
    height: 32,
  });

  await waitForText(setup, "cueloop");

  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

/** Leave a comment on the word, sent with the terminal-safe chord. */
async function comment(setup: Setup, word: string, body: string): Promise<void> {
  await clickText(setup, word);
  await type(setup, body);
  await pressKey(setup, "RETURN", { meta: true });
  await waitForText(setup, body);
}

/** Frames painted until the needle leaves the screen, starting right after a key with no settle. */
async function framesUntilGone(setup: Setup, needle: string, limit = 4): Promise<number> {
  for (let frame = 1; frame <= limit; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();
    if (!setup.captureCharFrame().includes(needle)) return frame;
  }
  throw new Error(`"${needle}" never left the frame`);
}

describe("the Tree tab", () => {
  test("option+t shows the tree: the revision, the comments, the current tip, a checkpoint", async () => {
    // Arrange
    const setup = await renderApp();

    await comment(setup, "daemon", "Which daemon?");

    // Act
    await pressKey(setup, "t", { meta: true });
    await waitForText(setup, "● comment");
    await pressKey(setup, "l", { meta: true });
    await waitForText(setup, "Checkpoint");
    await type(setup, "first pass");
    await press(setup, "enter");

    // Assert: the tip row carries the branch and the new label
    await waitForText(setup, "⚑ first pass");
    expect(setup.captureCharFrame()).toContain("◉ revision 1");
    expect(setup.captureCharFrame()).toContain("← main");
    await waitForState(
      setup,
      () => Object.values(server.core.sessionGet(session.id).history!.labels)[0] === "first pass",
    );
  });

  test("option+b branches; option+p / option+g move back and the path repaints in one frame", async () => {
    // Arrange: a comment on main, a branch, a second comment on it
    const setup = await renderApp();

    await comment(setup, "daemon", "Which daemon?");
    await pressKey(setup, "t", { meta: true });
    await waitForText(setup, "● comment");
    await pressKey(setup, "b", { meta: true });
    await waitForText(setup, "Branch");
    await type(setup, "alt");
    await press(setup, "enter");
    await waitForText(setup, "← main, alt");
    await comment(setup, "recovery", "Only on alt.");
    await waitForText(setup, "● comment  ← alt");

    // Act: stand on the revision (two rows up from alt's tip) and move back to it
    await pressKey(setup, "p", { meta: true });
    await pressKey(setup, "p", { meta: true });
    await pressKey(setup, "g", { meta: true });
    await waitForText(setup, "Move back");
    setup.mockInput.pressKey("RETURN");

    // Assert: both comments leave the document in the frame after the key; the record follows
    expect(await framesUntilGone(setup, "Only on alt.")).toBeLessThanOrEqual(1);
    expect(setup.captureCharFrame()).not.toContain("Which daemon?");
    await waitForState(setup, () => {
      const record = server.core.sessionGet(session.id);

      return (
        record.history!.branch === "alt" &&
        record.annotations.length === 0 &&
        record.shelvedAnnotations?.length === 2
      );
    });

    // Act: main's tip is the first comment - going there is a switch, no prompt
    await pressKey(setup, "n", { meta: true });
    await pressKey(setup, "g", { meta: true });

    // Assert
    await waitForText(setup, "on branch main");
    await waitForText(setup, "Which daemon?");
    expect(setup.captureCharFrame()).not.toContain("Only on alt.");
    await waitForState(setup, () => server.core.sessionGet(session.id).history!.branch === "main");
  });

  test("the mouse reaches the same primitives: the tab, a row, and the buttons", async () => {
    // Arrange
    const setup = await renderApp();

    await comment(setup, "daemon", "Which daemon?");

    // Act: open the tab, select the revision row, open the label prompt from its button
    await clickText(setup, "Tree");
    await waitForText(setup, "◉ revision 1");
    await clickText(setup, "◉ revision 1");
    await clickText(setup, "Label");

    // Assert
    await waitForText(setup, "Checkpoint");
    await press(setup, "escape");
    await waitForTextGone(setup, "Checkpoint");

    // Act: a second click on the selected row goes there - a move back asks for a summary
    await clickText(setup, "◉ revision 1");
    await waitForText(setup, "Move back");
  });

  test("a collaborator reads the tree and cannot move it", async () => {
    // Arrange
    const setup = await renderApp("collaborator");

    // Act
    await pressKey(setup, "t", { meta: true });
    await waitForText(setup, "● revision 1");
    await pressKey(setup, "b", { meta: true });

    // Assert: no prompt, the read-only answer, no buttons
    await waitForText(setup, "observer - read-only");
    expect(setup.captureCharFrame()).not.toContain("Fork+share");

    // Act: two clicks on the revision row select it and nothing more
    await clickText(setup, "● revision 1");
    await clickText(setup, "● revision 1");

    // Assert: no prompt opened, the record stands
    expect(setup.captureCharFrame()).not.toContain("Move back");
    expect(server.core.sessionGet(session.id).history!.entries).toHaveLength(1);
  });

  test("a resolved review keeps the fork buttons and drops the moving ones", async () => {
    // Arrange
    server.core.sessionResolve(session.id, "approve", "ship it");
    const setup = await renderApp();

    // Act
    await pressKey(setup, "t", { meta: true });
    await waitForText(setup, "Fork+share");

    // Assert
    expect(setup.captureCharFrame()).not.toContain("Branch");
    expect(setup.captureCharFrame()).not.toContain("Label");
  });
});
