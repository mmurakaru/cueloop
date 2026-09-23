/** The send-message confirm: cmd+enter opens a centered overlay with a message selector, summary input, and word-buttons. Char-frame assertions over the real App and an in-process daemon, like App.test.tsx. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import { makeAnchor, parseBlocks, type Thread } from "@cueloop/schema";
import { App } from "./App";
import {
  isolateUserConfig,
  press,
  pressKey,
  settle,
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
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: Thread;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-confirm-"));
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

async function renderApp(options: { readOnly?: boolean } = {}) {
  const setup = await testRender(
    <App home={home} sessionId={session.id} readOnly={options.readOnly ?? false} />,
    {
      width: 120,
      height: 32,
    },
  );

  await waitForText(setup, "cueloop");

  return setup;
}

/** Seed annotations directly through the daemon core (all on one block). */
function seedAnnotations(count: number): void {
  const blocks = parseBlocks(PLAN);

  for (let index = 1; index <= count; index++) {
    server.core.sessionAnnotate(session.id, {
      id: `a_confirm_${index}`,
      kind: "comment",
      anchor: makeAnchor(blocks, 2, 0, 10),
      body: `note ${String(index).padStart(2, "0")}`,
    });
  }
}

describe("send message confirm", () => {
  test("cmd+enter opens the send-message confirm overlay", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert - the footer carries the send control before the overlay opens
    expect(setup.captureCharFrame()).toContain("Send message (0)");

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the overlay: message selector and word-buttons
    await waitForText(setup, "[Approve]"); // nothing pending: approve default
    const frame = setup.captureCharFrame();

    expect(frame).toContain("[Approve]");
    expect(frame).toContain(" Comment ");
    expect(frame).toContain(" Request changes ");
    expect(frame).toContain(" send ");
    expect(frame).toContain(" cancel ");
  });

  test("left/right cycles the message selector in the overlay", async () => {
    // Arrange
    const setup = await renderApp();

    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "[Approve]");

    // Act
    await press(setup, "right");

    // Assert
    await waitForText(setup, "[Request changes]");

    // Act
    await press(setup, "right");

    // Assert
    await waitForText(setup, "[Comment]");

    // Act
    await press(setup, "left");

    // Assert
    await waitForText(setup, "[Request changes]");
  });

  test("esc closes the overlay", async () => {
    // Arrange
    const setup = await renderApp();

    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "[Approve]");

    // Act
    await press(setup, "escape");

    // Assert - a bare ESC settles after the parser's escape-sequence window
    const frame = await waitForTextGone(setup, "[Approve]");

    expect(frame).not.toContain(" cancel ");
  });

  test("enter in the overlay resolves the session through the controller", async () => {
    // Arrange
    seedAnnotations(1);
    const setup = await renderApp();

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - opens on the default message, then cycle to request changes
    await waitForText(setup, "[Approve]");
    await press(setup, "right");
    await waitForText(setup, "[Request changes]");

    // Act
    await setup.mockInput.typeText("Tighten the steps.");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the completion flow after submit is unchanged
    await waitForText(setup, "feedback sent");
    const stored = server.core.sessionGet(session.id);

    expect(stored.status).toBe("resolved");
    expect(stored.message!.outcome).toBe("changes_requested");
  });

  test("Comment sends feedback while leaving the Thread open", async () => {
    seedAnnotations(1);
    const setup = await renderApp();

    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "[Approve]");
    await press(setup, "left");
    await waitForText(setup, "[Comment]");

    await setup.mockInput.typeText("For now.");
    await pressKey(setup, "RETURN", { meta: true });

    await waitForText(setup, "comment sent - thread stays open");
    const stored = server.core.sessionGet(session.id);

    expect(stored.status).toBe("pending");
    expect(stored.message!.outcome).toBe("comment");
    expect(stored.message!.annotations?.map((annotation) => annotation.id)).toEqual([
      "a_confirm_1",
    ]);
    expect(setup.captureCharFrame()).not.toContain("feedback sent");
  });

  test("typing / in the summary opens the skills/actions palette", async () => {
    // Arrange
    seedAnnotations(1);
    const setup = await renderApp();
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "[Approve]");

    // Act
    await setup.mockInput.typeText("/restate");

    // Assert - the same slash palette the inline composer shows
    await waitForText(setup, "restate-simplified");
  });

  test("pasting an image into the summary drops in an [Image #n] placeholder", async () => {
    // Arrange
    const setup = await renderApp();
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "[Approve]");

    // Act - a burst of control bytes stands in for the binary an image paste delivers
    await setup.mockInput.typeText("look at this ");
    await setup.mockInput.pasteBracketedText("");

    // Assert - the raw bytes never reach the draft; a numbered placeholder does
    await waitForText(setup, "[Image #1]");
    expect(setup.captureCharFrame()).toContain("look at this [Image #1]");
  });

  test("read-only observers cannot open the confirm overlay", async () => {
    // Arrange
    seedAnnotations(1);
    const setup = await renderApp({ readOnly: true });

    // Act
    await pressKey(setup, "RETURN", { meta: true });
    await settle(setup);

    // Assert - no overlay, and the session stays pending
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("[Approve]");
    expect(frame).not.toContain(" cancel ");
    expect(server.core.sessionGet(session.id).status).toBe("pending");
  });
});
