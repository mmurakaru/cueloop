/**
 * Virtual-terminal component tests (tier 2): the real App over a real
 * in-process daemon in a temp home. Char-frame assertions + mock keys -
 * the whole review loop drivable without a terminal.
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
  home = mkdtempSync(join(tmpdir(), "cueloop-app-"));
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

async function renderApp(sessionId?: string) {
  const setup = await testRender(<App home={home} sessionId={sessionId ?? session.id} />, {
    width: 120,
    height: 32,
  });
  // let the async daemon connect + first fetch land
  for (let i = 0; i < 40 && !setup.captureCharFrame().includes("cueloop"); i++) {
    await Bun.sleep(25);
    await setup.renderOnce();
  }
  await setup.renderOnce();
  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

/** Drive one key press: letters type as text; named keys use KeyCodes ids. */
async function press(setup: Setup, k: string): Promise<void> {
  if (k === "enter") setup.mockInput.pressKey("RETURN");
  else if (k === "escape") setup.mockInput.pressKey("ESCAPE");
  else if (k === "backspace") setup.mockInput.pressKey("BACKSPACE");
  else if (k === "left") setup.mockInput.pressKey("ARROW_LEFT");
  else if (k === "right") setup.mockInput.pressKey("ARROW_RIGHT");
  else await type(setup, k);
  await Bun.sleep(15);
  await setup.renderOnce();
}

async function type(setup: Setup, text: string): Promise<void> {
  await setup.mockInput.typeText(text);
  await Bun.sleep(15);
  await setup.renderOnce();
}

describe("plan rendering", () => {
  test("renders the plan with headings, list markers, and the rail", async () => {
    const setup = await renderApp();
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
    const setup = await renderApp();
    await press(setup, "j");
    await press(setup, "j");
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    const cursorLine = lines.find((l) => l.includes("▎"))!;
    expect(cursorLine).toContain("persists sessions");
  });

  test("comment flow: c types a body, ⏎ saves to the daemon", async () => {
    const setup = await renderApp();
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "c");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain('comment on "The daemon');
    await type(setup, "Define atomically.");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.body).toBe("Define atomically.");
    expect(setup.captureCharFrame()).toContain("COMMENT");
  });

  test("span mode: v + l selects words, c anchors the exact span", async () => {
    const setup = await renderApp();
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "v");
    await press(setup, "l"); // "The daemon"
    await press(setup, "c");
    await type(setup, "Which daemon?");
    await press(setup, "enter");
    await Bun.sleep(80);
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations[0]!.anchor.quote).toBe("The daemon");
  });

  test("x cuts a block into the working copy; x restores it", async () => {
    const setup = await renderApp();
    // move to "- move the store" (h1, h2, p, h2 = 4 steps in)
    for (let i = 0; i < 4; i++) await press(setup, "j");
    await press(setup, "x");
    await Bun.sleep(80);
    await setup.renderOnce();
    expect(server.core.sessionGet(session.id).workingCopy).not.toContain("move the store");
    expect(setup.captureCharFrame()).toContain("[cut]");
    await press(setup, "x");
    await Bun.sleep(80);
    await setup.renderOnce();
    expect(server.core.sessionGet(session.id).workingCopy).toBeUndefined();
  });

  test("e runs $EDITOR on the working copy and tracks the diff", async () => {
    const script = join(home, "fake-editor.sh");
    await Bun.write(script, `#!/bin/sh\nsed -i '' 's/atomically/very atomically/' "$1"\n`);
    Bun.spawnSync(["chmod", "+x", script]);
    process.env.CUELOOP_EDITOR = script;
    try {
      const setup = await renderApp();
      await press(setup, "e");
      await Bun.sleep(150);
      await setup.renderOnce();
      expect(server.core.sessionGet(session.id).workingCopy).toContain("very atomically");
      expect(setup.captureCharFrame()).toContain("[edited]");
    } finally {
      delete process.env.CUELOOP_EDITOR;
    }
  });
});

describe("submit", () => {
  test("⏎ opens the verdict bar; verdict + summary resolve the session", async () => {
    const setup = await renderApp();
    await press(setup, "j");
    await press(setup, "j");
    await press(setup, "c");
    await type(setup, "Needs a phase list.");
    await press(setup, "enter");
    await Bun.sleep(80);
    await press(setup, "enter"); // open submit
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("[Request changes]");
    await type(setup, "Expand the steps.");
    await press(setup, "enter");
    await Bun.sleep(120);
    await setup.renderOnce();
    const stored = server.core.sessionGet(session.id);
    expect(stored.status).toBe("resolved");
    expect(stored.verdict!.kind).toBe("request_changes");
    expect(stored.verdict!.feedback).toContain("Needs a phase list.");
    // submit hands the reviewer back to the agent via the completion overlay
    expect(setup.captureCharFrame()).toContain("✎ feedback sent");
  });

  test("approve via ←/→ verdict cycling", async () => {
    const setup = await renderApp();
    await press(setup, "enter");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("[Approve]"); // no pending items → approve default
    await press(setup, "enter");
    await Bun.sleep(120);
    expect(server.core.sessionGet(session.id).verdict!.kind).toBe("approve");
  });
});

describe("inbox", () => {
  test("inbox mode renders and opens a session", async () => {
    const setup = await testRender(<App home={home} />, { width: 120, height: 32 });
    for (let i = 0; i < 40 && !setup.captureCharFrame().includes("inbox"); i++) {
      await Bun.sleep(25);
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain("inbox (1 pending)");
    expect(setup.captureCharFrame()).toContain("Migration Plan");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Submit review (0)");
  });
});
