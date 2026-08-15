/** The rail submit confirm (tier 2): pressing submit expands the rail's Submit button into a bordered confirm card - counts, verdict selector, summary input, word-buttons. Char-frame assertions over the real App and an in-process daemon, like App.test.tsx. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import { makeAnchor, parseBlocks, type ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { press, settle, waitForText, waitForTextGone } from "./test-support";

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

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-confirm-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Migration Plan", planPath: "plan.md" } },
  });
});
afterEach(() => {
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp(options: { readOnly?: boolean } = {}) {
  const setup = await testRender(<App home={home} sessionId={session.id} readOnly={options.readOnly ?? false} />, {
    width: 120,
    height: 32,
  });
  await waitForText(setup, "cueloop");
  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

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

describe("rail submit confirm", () => {
  test("submit expands the Submit button into the confirm card", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    expect(setup.captureCharFrame()).toContain("Submit review (0)");

    // Act
    await press(setup, "enter");

    // Assert
    const frame = setup.captureCharFrame();
    // the card: title, honest counts, verdict selector, word-buttons
    expect(frame).toContain("submit review");
    expect(frame).toContain("0 annotations · 0 blocking");
    expect(frame).toContain("[Approve]"); // nothing pending: approve default
    expect(frame).toContain(" Submit ");
    expect(frame).toContain(" Cancel ");
    // key hints live in the status line, not on the buttons
    expect(frame).toContain("verdict ←/→ · ⏎ submit · esc cancel");
    // the bottom bar stayed a one-line hint: no detached verdict bar
    expect(frame).not.toContain("Submit review (0) on ⏎");
  });

  test("left/right cycles the verdict selector in the card", async () => {
    // Arrange
    const setup = await renderApp();
    await press(setup, "enter");

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

  test("esc cancels the card and restores the plain Submit button", async () => {
    // Arrange
    const setup = await renderApp();
    await press(setup, "enter");

    // Assert
    expect(setup.captureCharFrame()).toContain("[Approve]");

    // Act
    await press(setup, "escape");

    // Assert
    // a bare ESC settles after the parser's escape-sequence window
    const frame = await waitForTextGone(setup, "[Approve]");
    expect(frame).not.toContain("0 annotations");
    expect(frame).toContain("Submit review (0)");
  });

  test("enter in the card resolves the session through the controller", async () => {
    // Arrange
    seedAnnotations(1);
    const setup = await renderApp();

    // Act
    await press(setup, "enter");

    // Assert
    const frame = setup.captureCharFrame();
    expect(frame).toContain("1 annotations · 0 blocking");
    expect(frame).toContain("[Changes]"); // pending items: request changes default

    // Act
    await setup.mockInput.typeText("Tighten the steps.");
    await press(setup, "enter");

    // Assert
    // the completion flow after submit is unchanged
    await waitForText(setup, "feedback sent");
    const stored = server.core.sessionGet(session.id);
    expect(stored.status).toBe("resolved");
    expect(stored.verdict!.kind).toBe("request_changes");
  });

  test("the annotation stack stays scrollable while the card is open", async () => {
    // Arrange
    seedAnnotations(12);
    const setup = await renderApp();

    // Act
    // walk annotation focus to the last card: the rail scrolls it into view
    for (let index = 0; index < 12; index++) await press(setup, "n");

    // Assert
    await waitForText(setup, "note 12");
    expect(setup.captureCharFrame()).not.toContain("note 01");

    // Act
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "12 annotations · 0 blocking");
    // the card is pinned outside the scrollbox; the stack stays scrolled off the top
    expect(setup.captureCharFrame()).not.toContain("note 01");

    // Act
    // the stack still scrolls with the card open: wheel over the rail
    // brings the last card back into view while the confirm card stays put
    for (let turn = 0; turn < 12; turn++) await setup.mockMouse.scroll(100, 10, "down");
    await settle(setup);

    // Assert
    await waitForText(setup, "note 12");
    const scrolledWithCard = setup.captureCharFrame();
    expect(scrolledWithCard).toContain("12 annotations · 0 blocking");
    expect(scrolledWithCard).not.toContain("note 01");
  });

  test("read-only observers never see the confirm card", async () => {
    // Arrange
    seedAnnotations(1);
    const setup = await renderApp({ readOnly: true });

    // Act
    await press(setup, "enter");

    // Assert
    const frame = setup.captureCharFrame();
    expect(frame).toContain("observer - read-only");
    expect(frame).not.toContain("1 annotations");
    expect(frame).not.toContain("[Changes]");
    expect(setup.captureCharFrame()).not.toContain("verdict ←/→");
    expect(server.core.sessionGet(session.id).status).toBe("pending");
  });
});
