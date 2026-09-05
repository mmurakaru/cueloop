/** The plan review surface v2: native selection feeds the annotation quote, the inline compose box keeps its anchor painted, the rail edits what the document selects, and edit-exit reconciliation orphans annotations whose passage was removed. Char-frame + styled-span assertions over the real App and a real in-process daemon. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { DEFAULT_QUICK_ACTIONS, quickActionBody } from "./config";
import {
  clickText,
  dragText,
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
  home = mkdtempSync(join(tmpdir(), "cueloop-plan-review-"));
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

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, {
    width: 120,
    height: 32,
  });

  await waitForText(setup, "cueloop");

  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

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

      backgrounds.push(
        "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join(""),
      );
    }
  }

  return backgrounds;
}

describe("share button", () => {
  test("the owner's plan header shows the Share button next to Edit", async () => {
    // Arrange / Act
    const setup = await renderApp();

    // Assert
    // both word-buttons ride the same header row, so Share sits next to Edit
    const headerLine = setup
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("submitted by"));

    expect(headerLine).toContain("Edit");
    expect(headerLine).toContain("Share");
  });

  test("a read-only viewer (a plan shared over ssh) never sees the Share button", async () => {
    // Arrange / Act
    const viewer = await testRender(<App home={home} sessionId={session.id} readOnly />, {
      width: 120,
      height: 32,
    });

    await waitForText(viewer, "cueloop");

    // Assert
    expect(viewer.captureCharFrame()).not.toContain("Share");
  });

  test("a resolved plan hides Edit and Share (no re-sharing a finished review)", async () => {
    // Arrange - resolve the session before opening it
    server.core.sessionResolve(session.id, "approve", "");

    // Act
    const setup = await renderApp();

    await waitForText(setup, "submitted by");

    // Assert - the owner toolbar is gone once the review is resolved
    const headerLine = setup
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("submitted by"));

    expect(headerLine).not.toContain("Edit");
    expect(headerLine).not.toContain("Share");
  });
});

describe("edit affordance", () => {
  test("the owner sees the Edit button", async () => {
    // Arrange / Act
    const owner = await renderApp();

    // Assert
    expect(owner.captureCharFrame()).toContain("Edit");
  });

  test("a read-only viewer (a plan shared over ssh) never sees the Edit button", async () => {
    // Arrange / Act
    const viewer = await testRender(<App home={home} sessionId={session.id} readOnly />, {
      width: 120,
      height: 32,
    });

    await waitForText(viewer, "cueloop");

    // Assert
    expect(viewer.captureCharFrame()).not.toContain("Edit");
  });
});

describe("marks feed the comment anchor", () => {
  test("a drag marks a character-precise span and typing anchors the comment to it", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await dragText(setup, "The daemon", "daemon persists", "daemon".length);
    await type(setup, "Which daemon?");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.anchor.quote).toBe("The daemon");
  });

  test("a drag that ends mid-sentence keeps exactly the dragged words", async () => {
    // Arrange
    const setup = await renderApp();

    // Act: release one past the last character of "sessions"
    await dragText(setup, "persists", "sessions", "sessions".length);
    await type(setup, "sessions plural?");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.anchor.quote).toBe(
      "persists sessions",
    );
  });
});

/** The thread view's mark backdrop in the dark palette. */
const THREAD_MARK = "#463852";

describe("the mark stays painted while composing", () => {
  test("the mark paints while composing, escape un-paints, save keeps it as the comment's mark", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await dragText(setup, "The daemon", "daemon persists", "daemon".length);
    await type(setup, "x");

    // Assert: composing, the marked words carry the mark backdrop
    await waitForText(setup, "● x");
    expect(backgroundsOf(setup, "The daemon")).toContain(THREAD_MARK);

    // Act: escape discards the draft; the mark stays for re-typing, a second escape drops it
    await press(setup, "escape");
    await waitForTextGone(setup, "● x");
    expect(backgroundsOf(setup, "The daemon")).toContain(THREAD_MARK);
    await press(setup, "escape");

    // Assert
    await waitForState(setup, () => !backgroundsOf(setup, "The daemon").includes(THREAD_MARK));

    // Act: mark again, save
    await dragText(setup, "The daemon", "daemon persists", "daemon".length);
    await type(setup, "Which daemon?");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert: the saved comment keeps the passage marked
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    await waitForState(setup, () => backgroundsOf(setup, "The daemon").includes(THREAD_MARK));
  }, 60_000);
});

describe("compose newline convention", () => {
  test("enter breaks the line; cmd+enter saves the multiline body verbatim", async () => {
    // Arrange
    const setup = await renderApp();

    await clickText(setup, "daemon");

    // Act
    await type(setup, "first line");
    await press(setup, "enter");
    await type(setup, "second line");

    // Assert: still composing, the newline did not save
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);

    // Act
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.body).toBe("first line\nsecond line");
  });

  test("escape cancels the composer without saving", async () => {
    // Arrange
    const setup = await renderApp();

    await clickText(setup, "daemon");
    await type(setup, "never saved");
    await waitForText(setup, "● never saved");

    // Act
    await press(setup, "escape");

    // Assert
    await waitForTextGone(setup, "● never saved");
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);
  });
});

describe("sheet header", () => {
  test("shows the submitting agent, the revision, and the Edit and Share word-buttons", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    const frame = setup.captureCharFrame();

    expect(frame).toContain("submitted by agent/worker-3");
    expect(frame).toContain("rev 1");
    expect(frame).toContain("Edit");
    expect(frame).toContain("Share");
  });
});

describe("quick-actions settings editor", () => {
  test("expanding an action edits its system prompt inline and persists it", async () => {
    // Arrange
    const setup = await renderApp();

    // Act - open Settings from the top-left gear, enter Actions, expand the first action, type
    await setup.mockMouse.click(1, 1);
    await clickText(setup, "Settings");
    await clickText(setup, "Actions");
    await clickText(setup, "Zoom out, research in depth");
    await type(setup, "CUSTOM");
    await setup.renderOnce();

    // Assert - the keystrokes reached the focused input (not swallowed by nav) and persisted
    expect(setup.captureCharFrame()).toContain("CUSTOM");
    await waitForState(setup, () =>
      readFileSync(join(home, "no-config.toml"), "utf8").includes("CUSTOM"),
    );
  });
});

describe("edit-exit reconciliation", () => {
  test("an edit that removes an anchored passage orphans the annotation and shows the banner", async () => {
    const script = join(home, "fake-editor.sh");

    await Bun.write(script, `#!/bin/sh\nsed -i '' '/^The daemon persists/d' "$1"\n`);
    Bun.spawnSync(["chmod", "+x", script]);
    process.env.CUELOOP_EDITOR = script;
    try {
      // Arrange
      const setup = await renderApp();

      await clickText(setup, "daemon");
      await type(setup, "Anchor me to the doomed passage.");
      await pressKey(setup, "RETURN", { meta: true });
      await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);

      // Act
      await pressKey(setup, "e", { ctrl: true });

      // Assert - the thread view banner reports the orphaned annotation
      await waitForText(setup, "1 annotation no longer match - the passage was removed.");
      // the annotation is NOT deleted: the feedback serializer handles orphans
      expect(server.core.sessionGet(session.id).annotations.length).toBe(1);
    } finally {
      delete process.env.CUELOOP_EDITOR;
    }
  });
});

describe("the quick-action palette", () => {
  test("/ lists the quick actions and a pick seeds the comment with the preset body", async () => {
    // Arrange
    const setup = await renderApp();

    await dragText(setup, "The daemon", "daemon persists", "daemon".length);

    // Act - a leading slash opens the palette; step to the second default and pick it
    await type(setup, "/");
    await waitForText(setup, "zoom-out-research-in-depth");
    await pressKey(setup, "ARROW_DOWN");
    await press(setup, "enter");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - a comment annotation was created with the second default's body
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id);

    expect(stored.annotations[0]!.kind).toBe("comment");
    expect(stored.annotations[0]!.body).toBe(quickActionBody(DEFAULT_QUICK_ACTIONS[1]!));
  });
});
