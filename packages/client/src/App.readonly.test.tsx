/** Observer mode (tier 2): the App with readOnly renders and navigates like the controller's, but every mutating verb answers "observer - read-only" and leaves daemon state untouched. */

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
import { isolateUserConfig, press, waitForState, waitForText } from "./test-support";

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

/** Session state that any mutating verb would change. */
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

describe("observer verbs are blocked", () => {
  for (const [key, verb] of [
    ["c", "comment"],
    ["x", "cut"],
    ["e", "edit"],
    ["enter", "submit"],
  ] as const) {
    test(`${verb} (${key}) answers observer - read-only and mutates nothing`, async () => {
      const setup = await renderObserver();
      const before = snapshot();
      await press(setup, "j");
      await press(setup, "j");
      await press(setup, key);
      const frame = await waitForText(setup, "observer - read-only");
      // no overlay opened: compose/submit bars never appear
      expect(frame).not.toContain('comment on "');
      expect(frame).not.toContain("verdict ←/→");
      expect(snapshot()).toEqual(before);
    });
  }

  test("span mode c is blocked too", async () => {
    // Arrange
    const setup = await renderObserver();

    // Act
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "v");
    await press(setup, "c");
    await setup.renderOnce();

    // Assert
    const frame = setup.captureCharFrame();
    expect(frame).toContain("observer - read-only");
    expect(frame).not.toContain('comment on "');
    expect(snapshot().annotations).toBe(0);
  });
});

describe("observer navigation still works", () => {
  test("j/k moves the cursor between blocks", async () => {
    // Arrange
    const setup = await renderObserver();

    // Act
    await press(setup, "j");
    await press(setup, "j");
    await setup.renderOnce();

    // Assert
    const lines = setup.captureCharFrame().split("\n");
    const cursorLine = lines.find((line) => line.includes("▎"))!;
    expect(cursorLine).toContain("persists sessions");
  });

  test("n focuses annotations made by the controller", async () => {
    // Arrange
    server.core.sessionAnnotate(session.id, {
      id: "a_obs1",
      kind: "comment",
      anchor: makeAnchor(parseBlocks(PLAN), 2, 0, 10),
      body: "From the controller.",
    });
    const setup = await renderObserver();

    // Act
    await press(setup, "n");
    await setup.renderOnce();

    // Assert - focus shows as the card's bright kind-colored border (transparent
    // fill); a selected card is the only accent-colored border in the frame
    await waitForText(setup, "COMMENT · me");
    await waitForState(setup, () => hasBorderColor(setup, DARK.accent));
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
