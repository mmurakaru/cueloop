/** The plan review surface v2: native selection feeds the annotation quote, the inline compose box keeps its anchor painted, the rail edits what the document selects, and edit-exit reconciliation orphans annotations whose passage was removed. Char-frame + styled-span assertions over the real App and a real in-process daemon. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { DARK } from "./theme";
import {
  isolateUserConfig,
  press,
  settle,
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

/** Whether any styled span in the frame paints the given background hex. */
function hasBackground(setup: Setup, hex: string): boolean {
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      const [red, green, blue] = span.bg.toInts();
      const rendered =
        "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
      if (rendered === hex) return true;
    }
  }
  return false;
}

/** Move the cursor to "The daemon persists sessions to disk atomically." */
async function toContextParagraph(setup: Setup): Promise<void> {
  await press(setup, "j");
  await press(setup, "j");
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

describe("attribution", () => {
  test("a collaborator's note shows their name in the card border", async () => {
    // Arrange - a pulled collaborator note carries an author fingerprint
    const { makeAnchor, parseBlocks } = await import("@cueloop/schema");
    const blocks = parseBlocks(PLAN);
    const contextBlockIndex = blocks.findIndex((block) =>
      block.text.startsWith("The daemon persists"),
    );
    server.core.sessionAnnotate(session.id, {
      id: "collab-1",
      kind: "comment",
      anchor: makeAnchor(blocks, contextBlockIndex, 0, 10),
      body: "who owns retries?",
      author: "SHA256:1a2b3c4d5e6f",
    });

    // Act
    const setup = await renderApp();

    // Assert - the short author handle rides the card border
    await waitForText(setup, "1a2b3c4d");
  });
});

describe("selection feeds the annotation quote", () => {
  test("v anchors, l extends, c composes with the char-precise quote", async () => {
    // Arrange
    const setup = await renderApp();
    await toContextParagraph(setup);

    // Act
    await press(setup, "v");
    await press(setup, "l"); // "The daemon"
    await press(setup, "c");

    // Assert
    await waitForText(setup, 'comment on "The daemon"');

    // Act
    await type(setup, "Which daemon?");
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations[0]!.anchor.quote).toBe("The daemon");
  });

  test("a mouse drag over the text becomes the compose quote", async () => {
    // Arrange
    const setup = await renderApp();
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("persists sessions"));
    const startColumn = lines[row]!.indexOf("persists");
    expect(row).toBeGreaterThan(-1);

    // Act
    // the drag's end cell is exclusive: release one past the last character
    await setup.mockMouse.drag(startColumn, row, startColumn + "persists sessions".length, row);
    await settle(setup);
    await press(setup, "c");

    // Assert
    await waitForText(setup, 'comment on "persists sessions"');

    // Act
    await type(setup, "sessions plural?");
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations[0]!.anchor.quote).toBe("persists sessions");
  });
});

describe("inline compose keeps the anchor painted", () => {
  test("the selection stays painted while composing; cancel un-paints; save converts to the comment highlight", async () => {
    // Arrange
    const setup = await renderApp();
    await toContextParagraph(setup);

    // Act
    await press(setup, "v");
    await press(setup, "l");
    await press(setup, "c");

    // Assert
    // compose open: the anchor is painted selection-style. The box can render
    // a frame before the anchor repaint settles, so wait on the color itself.
    await waitForText(setup, "Save");
    expect(setup.captureCharFrame()).toContain("Cancel");
    await waitForState(setup, () => backgroundsOf(setup, "The daemon").includes(DARK.accent));
    expect(backgroundsOf(setup, "The daemon")).toContain(DARK.accent);

    // Act
    // cancel un-paints (a bare ESC settles after the parser's escape window)
    await press(setup, "escape");

    // Assert
    await waitForTextGone(setup, 'comment on "');
    expect(backgroundsOf(setup, "The daemon")).not.toContain(DARK.accent);

    // Act
    // save converts the paint to the kind-colored annotation highlight
    await press(setup, "c");
    await type(setup, "Which daemon?");
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    await settle(setup);
    // the whole cursor block is the anchor here; check the highlight landed
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(backgroundsOf(setup, stored.annotations[0]!.anchor.quote.slice(0, 20))).toContain(
      DARK.markCommentBackground,
    );
    // renderApp plus this many frame-waits grazes the 5s default on a loaded CI
    // runner, and the whole-suite publish lane has timed even 15s out; give the
    // heaviest frame-wait chain generous headroom so runner load cannot flake it.
  }, 60_000);
});

describe("compose newline convention", () => {
  // Option/Alt and Shift reach the App as `meta`/`shift` on the return key.
  // modifyOtherKeys encoding preserves those modifiers so the grammar and the
  // focused textarea can tell a bare submit from a newline.
  async function renderModifierAwareApp() {
    const setup = await testRender(<App home={home} sessionId={session.id} />, {
      width: 120,
      height: 32,
      otherModifiersMode: true,
    });
    await waitForText(setup, "cueloop");
    return setup;
  }

  async function pressReturnWith(
    setup: Setup,
    modifiers: { shift?: boolean; meta?: boolean },
  ): Promise<void> {
    setup.mockInput.pressKey("RETURN", modifiers);
    await settle(setup);
  }

  test("option+return inserts a newline; a bare return submits the multiline body", async () => {
    // Arrange
    const setup = await renderModifierAwareApp();
    await toContextParagraph(setup);
    await press(setup, "v");
    await press(setup, "l");
    await press(setup, "c");
    await waitForText(setup, 'comment on "The daemon"');

    // Act
    await type(setup, "first line");
    await pressReturnWith(setup, { meta: true }); // option/alt+return -> newline
    await type(setup, "second line");

    // Assert
    // still composing: the newline did not submit
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);

    // Act
    await press(setup, "enter"); // bare return -> save

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.body).toBe("first line\nsecond line");
  });

  test("shift+return still inserts a newline (existing muscle memory)", async () => {
    // Arrange
    const setup = await renderModifierAwareApp();
    await toContextParagraph(setup);
    await press(setup, "c");

    // Act
    await type(setup, "alpha");
    await pressReturnWith(setup, { shift: true }); // shift+return -> newline
    await type(setup, "beta");

    // Assert
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);

    // Act
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.body).toBe("alpha\nbeta");
  });

  test("escape cancels the composer without saving", async () => {
    // Arrange
    const setup = await renderModifierAwareApp();
    await toContextParagraph(setup);
    await press(setup, "c");
    await waitForText(setup, 'comment on "');
    await type(setup, "never saved");

    // Act
    await press(setup, "escape");

    // Assert
    await waitForTextGone(setup, 'comment on "');
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);
  });
});

describe("the document selects, the rail edits", () => {
  test("e edits the selected card in place; enter saves through the controller", async () => {
    // Arrange
    const setup = await renderApp();
    await toContextParagraph(setup);
    await press(setup, "c");
    await type(setup, "Needs a citation.");
    await press(setup, "enter");
    await waitForText(setup, "COMMENT · me");

    // Act
    // the saved card is selected; e turns its body into an input in place
    await press(setup, "e");
    await type(setup, " And a link.");
    await press(setup, "enter");

    // Assert
    await waitForState(
      setup,
      () =>
        server.core.sessionGet(session.id).annotations[0]!.body === "Needs a citation. And a link.",
    );
  });

  test("activating a collaborator's card opens rename, not a body edit", async () => {
    // Arrange - a pulled collaborator note carries an author fingerprint
    const { makeAnchor, parseBlocks } = await import("@cueloop/schema");
    const blocks = parseBlocks(PLAN);
    const contextBlockIndex = blocks.findIndex((block) =>
      block.text.startsWith("The daemon persists"),
    );
    server.core.sessionAnnotate(session.id, {
      id: "collab-1",
      kind: "comment",
      anchor: makeAnchor(blocks, contextBlockIndex, 0, 10),
      body: "who owns retries?",
      author: "SHA256:1a2b3c4d5e6f",
    });
    const setup = await renderApp();
    await waitForText(setup, "1a2b3c4d");

    // Act - focus the collaborator card, then activate it
    await press(setup, "n");
    await press(setup, "e");

    // Assert - the rename prompt opens; the body never becomes an editor
    await waitForText(setup, "Rename author");
  });

  test("x deletes the selected card and un-paints the document highlight", async () => {
    // Arrange
    const setup = await renderApp();
    await toContextParagraph(setup);
    await press(setup, "c");
    await type(setup, "Delete me.");
    await press(setup, "enter");
    await waitForText(setup, "COMMENT · me");
    expect(server.core.sessionGet(session.id).annotations.length).toBe(1);
    expect(backgroundsOf(setup, "persists sessions")).toContain(DARK.markCommentBackground);

    // Act
    await press(setup, "x");

    // Assert
    await waitForTextGone(setup, "COMMENT · me");
    expect(server.core.sessionGet(session.id).annotations.length).toBe(0);
    expect(backgroundsOf(setup, "persists sessions")).not.toContain(DARK.markCommentBackground);
  });
});

describe("plan cut removals", () => {
  test("a cut block becomes a rail removal card and u restores it", async () => {
    // Arrange
    const setup = await renderApp();
    await toContextParagraph(setup);

    // Act - no card is selected, so x cuts the block under the cursor
    await press(setup, "x");

    // Assert - the rail shows a removal card titled CUT · me for the cut block
    await waitForText(setup, "CUT · me");
    await waitForState(setup, () => server.core.sessionGet(session.id).workingCopy !== undefined);

    // Act - undo restores it (no selection, so the last removal)
    await press(setup, "u");

    // Assert - the block returns and the working copy is pristine again
    await waitForText(setup, "removal restored");
    await waitForState(setup, () => server.core.sessionGet(session.id).workingCopy === undefined);
  });
});

describe("addressed annotations leave the open list", () => {
  test("a revision that addresses one card hides it, un-paints it, and shows the count", async () => {
    // Arrange: two annotations through the daemon, then a revision addressing one
    const { makeAnchor, parseBlocks } = await import("@cueloop/schema");
    const blocks = parseBlocks(PLAN);
    const contextBlockIndex = blocks.findIndex((block) =>
      block.text.startsWith("The daemon persists"),
    );
    server.core.sessionAnnotate(session.id, {
      id: "a_settled",
      kind: "comment",
      anchor: makeAnchor(blocks, contextBlockIndex, 0, 10), // "The daemon"
      body: "settled note",
    });
    server.core.sessionAnnotate(session.id, {
      id: "a_open",
      kind: "comment",
      anchor: makeAnchor(blocks, contextBlockIndex, 11, 19), // "persists"
      body: "still open note",
    });
    server.core.sessionSubmitRevision(session.id, PLAN, ["a_settled"]);

    // Act
    const setup = await renderApp();
    await waitForText(setup, "still open note");

    // Assert: the open card renders, the addressed one is gone behind the count
    const frame = setup.captureCharFrame();
    expect(frame).toContain("✓ 1 addressed by revision");
    expect(frame).not.toContain("settled note");
    expect(frame).toContain("still open note"); // the open card survives; the addressed one does not
    expect(backgroundsOf(setup, "The daemon")).not.toContain(DARK.markCommentBackground); // no highlight paint
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

  test("the Agent tab shows the submitter, status, and revision", async () => {
    // Arrange
    const setup = await renderApp();
    const lines = setup.captureCharFrame().split("\n");
    const tabRow = lines.findIndex((line) => line.includes("Review") && line.includes("Agent"));
    const tabColumn = lines[tabRow]!.indexOf("Agent");

    // Act
    await setup.mockMouse.click(tabColumn + 1, tabRow);
    await setup.renderOnce();

    // Assert
    await waitForText(setup, "status: pending");
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
      // Arrange
      const setup = await renderApp();
      await toContextParagraph(setup);
      await press(setup, "c");
      await type(setup, "Anchor me to the doomed passage.");
      await press(setup, "enter");
      await waitForText(setup, "COMMENT · me");

      // Act
      // deselect the card so e reaches the editor hand-off, then edit; deselection
      // shows as the selected card's elevated fill leaving the frame (no marker glyph)
      await press(setup, "escape");
      await waitForState(setup, () => !hasBackground(setup, DARK.elevated));
      await press(setup, "e");

      // Assert
      await waitForText(setup, "1 annotation no longer match - the passage was removed.");
      // the rail card flips to ORPHANED once the working-copy refresh lands
      await waitForText(setup, "· ORPHANED");
      // the annotation is NOT deleted: the feedback serializer handles orphans
      expect(server.core.sessionGet(session.id).annotations.length).toBe(1);
    } finally {
      delete process.env.CUELOOP_EDITOR;
    }
  });
});

describe("marker-actions popover", () => {
  test("v shows the toolbar, a opens quick-actions, enter inserts the preset comment", async () => {
    // Arrange
    const setup = await renderApp();
    await toContextParagraph(setup);

    // Act - marking a span reveals the inline toolbar
    await press(setup, "v");
    await waitForText(setup, "actions");

    // open the quick-actions list; step to the second default and pick it. The
    // list renders as a floating overlay the virtual terminal cannot composite,
    // so drive the grammar directly rather than waiting on its painted text.
    await press(setup, "a");
    await press(setup, "j");
    await press(setup, "enter");

    // Assert - a comment annotation was created with the second default's body
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations[0]!.kind).toBe("comment");
    expect(stored.annotations[0]!.body).toBe("Restate simplified");
  });
});
