/** The send-message confirm: cmd+enter opens a centered overlay with a verdict selector, summary input, and word-buttons. Char-frame assertions over the real App and an in-process daemon, like App.test.tsx. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import { makeAnchor, parseBlocks, type ReviewSession } from "@cueloop/schema";
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
let session: ReviewSession;

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
    expect(setup.captureCharFrame()).toContain("send message");

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the overlay: verdict selector and word-buttons
    await waitForText(setup, "[Approve]"); // nothing pending: approve default
    const frame = setup.captureCharFrame();

    expect(frame).toContain("[Approve]");
    expect(frame).toContain(" send message ");
    expect(frame).toContain(" Cancel ");
  });

  test("left/right cycles the verdict selector in the overlay", async () => {
    // Arrange
    const setup = await renderApp();

    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "[Approve]");

    // Act
    await press(setup, "right");

    // Assert
    await waitForText(setup, "[Changes]");

    // Act
    await press(setup, "right");

    // Assert
    await waitForText(setup, "[Comment]");

    // Act
    await press(setup, "left");

    // Assert
    await waitForText(setup, "[Changes]");
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

    expect(frame).not.toContain(" Cancel ");
  });

  test("enter in the overlay resolves the session through the controller", async () => {
    // Arrange
    seedAnnotations(1);
    const setup = await renderApp();

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "[Changes]"); // pending items: request changes default

    // Act
    await setup.mockInput.typeText("Tighten the steps.");
    await press(setup, "enter");

    // Assert - the completion flow after submit is unchanged
    await waitForText(setup, "feedback sent");
    const stored = server.core.sessionGet(session.id);

    expect(stored.status).toBe("resolved");
    expect(stored.verdict!.kind).toBe("request_changes");
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

    expect(frame).not.toContain("[Changes]");
    expect(frame).not.toContain(" Cancel ");
    expect(server.core.sessionGet(session.id).status).toBe("pending");
  });
});
