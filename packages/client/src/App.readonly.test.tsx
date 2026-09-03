/** Observer mode (tier 2): the App with readOnly renders and navigates like the controller's, but every mutating primitive answers "observer - read-only" and leaves daemon state untouched. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import { makeAnchor, parseBlocks, type ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { DARK } from "./theme";
import {
  clickText,
  dragText,
  frameRow,
  isolateUserConfig,
  pressKey,
  typeText,
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
  home = mkdtempSync(join(tmpdir(), "cueloop-observer-"));
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

async function renderObserver() {
  const setup = await testRender(<App home={home} sessionId={session.id} readOnly />, {
    width: 120,
    height: 32,
  });

  await waitForText(setup, "cueloop");

  return setup;
}

type Setup = Awaited<ReturnType<typeof renderObserver>>;

/** Session state that any mutating primitive would change. */
function snapshot() {
  const stored = server.core.sessionGet(session.id);

  return {
    annotations: stored.annotations.length,
    workingCopy: stored.workingCopy,
    status: stored.status,
  };
}

describe("observer rendering", () => {
  test("shows the observer badge and the bottom menu", async () => {
    // Arrange
    const setup = await renderObserver();

    // Assert
    const frame = setup.captureCharFrame();

    expect(frame).toContain("· observer");
    expect(frame).toContain("menu");
  });
});

describe("observer primitives are blocked", () => {
  const attempts: Array<[string, (setup: Setup) => Promise<void>]> = [
    ["comment (typing)", (setup) => typeText(setup, "c")],
    ["cut (option+x)", (setup) => pressKey(setup, "x", { meta: true })],
    ["edit (ctrl+e)", (setup) => pressKey(setup, "e", { ctrl: true })],
    ["submit (cmd+enter)", (setup) => pressKey(setup, "RETURN", { meta: true })],
  ];

  for (const [primitive, attempt] of attempts) {
    test(`${primitive} answers observer - read-only and mutates nothing`, async () => {
      const setup = await renderObserver();
      const before = snapshot();

      await clickText(setup, "daemon");
      await attempt(setup);
      const frame = await waitForText(setup, "observer - read-only");

      // no draft card and no submit card ever appear
      expect(frame).not.toContain("● c");
      expect(frame).not.toContain("[Approve]");
      expect(snapshot()).toEqual(before);
    });
  }

  test("typing over a marked span is blocked too", async () => {
    // Arrange
    const setup = await renderObserver();

    // Act
    await dragText(setup, "The daemon", "daemon persists", "daemon".length);
    await typeText(setup, "c");

    // Assert
    const frame = await waitForText(setup, "observer - read-only");

    expect(frame).not.toContain("● c");
    expect(snapshot().annotations).toBe(0);
  });
});

describe("observer navigation still works", () => {
  test("↓ moves the caret between blocks", async () => {
    // Arrange
    const setup = await renderObserver();

    // Act
    await pressKey(setup, "ARROW_DOWN");
    await pressKey(setup, "ARROW_DOWN");
    await setup.renderOnce();

    // Assert: the caret cell is painted on the paragraph's row
    const caretRow = setup
      .captureSpans()
      .lines.findIndex((line) =>
        line.spans.some((span) => span.bg.toInts().slice(0, 3).join() === "86,91,104"),
      );

    expect(caretRow).toBe(frameRow(setup, "persists sessions"));
  });

  test("option+n focuses annotations made by the controller", async () => {
    // Arrange
    server.core.sessionAnnotate(session.id, {
      id: "a_obs1",
      kind: "comment",
      anchor: makeAnchor(parseBlocks(PLAN), 2, 0, 10),
      body: "From the controller.",
    });
    const setup = await renderObserver();

    // Act
    await pressKey(setup, "n", { meta: true });
    await setup.renderOnce();

    // Assert - focus shows as the card's blue border (transparent fill); a
    // comment card is the only blue-bordered box in the frame
    await waitForText(setup, "COMMENT · me");
    await waitForState(setup, () => hasBorderColor(setup, DARK.blue));
  });
});

/** Whether any border character (box-drawing) is painted in the given foreground hex. */
function hasBorderColor(setup: Awaited<ReturnType<typeof renderObserver>>, hex: string): boolean {
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!/[╭╮╰╯│─┌┐└┘]/.test(span.text)) continue;
      const [red, green, blue] = span.fg.toInts();
      const rendered =
        "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");

      if (rendered === hex) return true;
    }
  }

  return false;
}
