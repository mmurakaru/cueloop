/**
 * The plan review surface v2 (#71): native selection feeds the annotation
 * quote, the inline compose box keeps its anchor painted, the rail edits what
 * the document selects, and edit-exit reconciliation orphans annotations
 * whose passage was removed. Char-frame + styled-span assertions over the
 * real App and a real in-process daemon.
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
import { DARK as T } from "./theme";

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
  home = mkdtempSync(join(tmpdir(), "cueloop-plan-review-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Migration Plan", planPath: "plan.md", agent: "agent/worker-3" } },
  });
});
afterEach(() => {
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, {
    width: 120,
    height: 32,
  });
  for (let attempt = 0; attempt < 40 && !setup.captureCharFrame().includes("cueloop"); attempt++) {
    await Bun.sleep(25);
    await setup.renderOnce();
  }
  await setup.renderOnce();
  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

async function press(setup: Setup, k: string): Promise<void> {
  if (k === "enter") setup.mockInput.pressKey("RETURN");
  else if (k === "escape") {
    setup.mockInput.pressKey("ESCAPE");
    // a bare ESC byte is an ambiguous sequence prefix; the parser settles late
    await Bun.sleep(120);
  } else await type(setup, k);
  await Bun.sleep(15);
  await setup.renderOnce();
}

async function type(setup: Setup, text: string): Promise<void> {
  await setup.mockInput.typeText(text);
  await Bun.sleep(15);
  await setup.renderOnce();
}

/**
 * Background colors (hex) of every styled span containing the needle - the
 * document highlight and the rail's quote excerpt can both match.
 */
function backgroundsOf(setup: Setup, needle: string): string[] {
  const backgrounds: string[] = [];
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue;
      const [red, green, blue] = span.bg.toInts();
      backgrounds.push("#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join(""));
    }
  }
  return backgrounds;
}

/** Move the cursor to "The daemon persists sessions to disk atomically." */
async function toContextParagraph(setup: Setup): Promise<void> {
  await press(setup, "j");
  await press(setup, "j");
}

describe("selection feeds the annotation quote", () => {
  test("v anchors, l extends, c composes with the char-precise quote", async () => {
    const setup = await renderApp();
    await toContextParagraph(setup);
    await press(setup, "v");
    await press(setup, "l"); // "The daemon"
    await press(setup, "c");
    expect(setup.captureCharFrame()).toContain('comment on "The daemon"');
    await type(setup, "Which daemon?");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.anchor.quote).toBe("The daemon");
  });

  test("a mouse drag over the text becomes the compose quote", async () => {
    const setup = await renderApp();
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("persists sessions"));
    const startColumn = lines[row]!.indexOf("persists");
    expect(row).toBeGreaterThan(-1);
    // the drag's end cell is exclusive: release one past the last character
    await setup.mockMouse.drag(startColumn, row, startColumn + "persists sessions".length, row);
    await setup.renderOnce();
    await press(setup, "c");
    expect(setup.captureCharFrame()).toContain('comment on "persists sessions"');
    await type(setup, "sessions plural?");
    await press(setup, "enter");
    await Bun.sleep(80);
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations[0]!.anchor.quote).toBe("persists sessions");
  });
});

describe("inline compose keeps the anchor painted", () => {
  test("the selection stays painted while composing; cancel un-paints; save converts to the comment highlight", async () => {
    const setup = await renderApp();
    await toContextParagraph(setup);
    await press(setup, "v");
    await press(setup, "l");
    await press(setup, "c");
    // compose open: the anchor is painted selection-style
    expect(setup.captureCharFrame()).toContain("Save ⏎");
    expect(setup.captureCharFrame()).toContain("Cancel esc");
    expect(backgroundsOf(setup, "The daemon")).toContain(T.accent);
    // cancel un-paints
    await press(setup, "escape");
    expect(setup.captureCharFrame()).not.toContain('comment on "');
    expect(backgroundsOf(setup, "The daemon")).not.toContain(T.accent);
    // save converts the paint to the kind-colored annotation highlight
    await press(setup, "c");
    await type(setup, "Which daemon?");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    // the whole cursor block is the anchor here; check the highlight landed
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(backgroundsOf(setup, stored.annotations[0]!.anchor.quote.slice(0, 20))).toContain(T.markCommentBg);
  });
});

describe("the document selects, the rail edits", () => {
  test("e edits the selected card in place; enter saves through the controller", async () => {
    const setup = await renderApp();
    await toContextParagraph(setup);
    await press(setup, "c");
    await type(setup, "Needs a citation.");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("COMMENT · pending");
    // the saved card is selected; e turns its body into an input in place
    await press(setup, "e");
    await type(setup, " And a link.");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.body).toBe("Needs a citation. And a link.");
  });

  test("x deletes the selected card and un-paints the document highlight", async () => {
    const setup = await renderApp();
    await toContextParagraph(setup);
    await press(setup, "c");
    await type(setup, "Delete me.");
    await press(setup, "enter");
    await Bun.sleep(80);
    await setup.renderOnce();
    expect(server.core.sessionGet(session.id).annotations.length).toBe(1);
    expect(backgroundsOf(setup, "persists sessions")).toContain(T.markCommentBg);
    await press(setup, "x");
    await Bun.sleep(80);
    await setup.renderOnce();
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);
    expect(setup.captureCharFrame()).not.toContain("COMMENT · pending");
    expect(backgroundsOf(setup, "persists sessions")).not.toContain(T.markCommentBg);
  });
});

describe("sheet header", () => {
  test("shows the submitting agent, the revision, and the Edit word-button", async () => {
    const setup = await renderApp();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("submitted by agent/worker-3 · revision 1");
    expect(frame).toContain("Edit");
  });

  test("the Agent tab shows the submitter, status, and revision", async () => {
    const setup = await renderApp();
    const lines = setup.captureCharFrame().split("\n");
    const tabRow = lines.findIndex((line) => line.includes("Review (0)"));
    const tabColumn = lines[tabRow]!.indexOf("Agent");
    await setup.mockMouse.click(tabColumn + 1, tabRow);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("agent/worker-3");
    expect(frame).toContain("status: pending");
    expect(frame).toContain("revision 1");
  });
});

describe("edit-exit reconciliation", () => {
  test("an edit that removes an anchored passage orphans the annotation and shows the banner", async () => {
    const script = join(home, "fake-editor.sh");
    await Bun.write(script, `#!/bin/sh\nsed -i '' '/^The daemon persists/d' "$1"\n`);
    Bun.spawnSync(["chmod", "+x", script]);
    process.env.CUELOOP_EDITOR = script;
    try {
      const setup = await renderApp();
      await toContextParagraph(setup);
      await press(setup, "c");
      await type(setup, "Anchor me to the doomed passage.");
      await press(setup, "enter");
      await Bun.sleep(80);
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("· pending");
      // deselect the card so e reaches the editor hand-off, then edit
      await press(setup, "escape");
      await press(setup, "e");
      await Bun.sleep(150);
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("1 annotation no longer match - the passage was removed.");
      expect(frame).toContain("· ORPHANED");
      // the annotation is NOT deleted: the feedback serializer handles orphans
      expect(server.core.sessionGet(session.id).annotations.length).toBe(1);
    } finally {
      delete process.env.CUELOOP_EDITOR;
    }
  });
});
