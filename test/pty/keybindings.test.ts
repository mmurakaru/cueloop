/**
 * PTY keybinding suite: every chord the thread view advertises, pressed as the
 * bytes a terminal sends, against the real TUI. In a live review the letters
 * type a comment, so the grammar under test is the chord tables in
 * thread-chords.ts - the same tables the keybinds dialog renders. The last
 * test enumerates those tables and fails on any chord without an expectation,
 * so a new chord cannot ship without a screen-level proof or a documented
 * reason it is unwired. Coverage is collected while the earlier tests run, so
 * the tier is serial and a single test run in isolation reports every chord as
 * missing. Env-gated behind CUELOOP_RUN_PTY (`bun run test:pty`).
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  DIFF_CHORD_ENTRIES,
  RAIL_CHORD_ENTRIES,
  THREAD_CHORD_ENTRIES,
  TREE_CHORD_ENTRIES,
} from "../../packages/client/src/thread-chords";
import type { TestGitRepo } from "../helpers/git-repo";
import { cheatsheetChordKeyPress, cheatsheetEntryChords } from "../helpers/pty-key-codes";
import {
  EDIT_MARKER,
  OTHER_CHANGE,
  PTY_TIER_ENABLED,
  ROLLOUT_PLAN_LAST_LINE,
  STORE_CHANGE,
  launchDiffReview,
  launchPlanReview,
  ptyTest,
} from "../helpers/pty-reviews";
import {
  OFFLINE_SSH_MESSAGE,
  type PtyScreenWaitOptions,
  type PtyTuiSession,
} from "../helpers/pty-tui-session";
import { createTestReviewHome, type TestReviewHome } from "../helpers/review-home";

/** The chord tables the cheatsheet renders, by the name the coverage test reports. */
const CHORD_TABLES = {
  diff: DIFF_CHORD_ENTRIES,
  thread: THREAD_CHORD_ENTRIES,
  rail: RAIL_CHORD_ENTRIES,
  tree: TREE_CHORD_ENTRIES,
} as const;

type ChordTable = keyof typeof CHORD_TABLES;

/** Chords the cheatsheet advertises with no visible effect; each names the tracking issue. */
const UNWIRED_CHORDS = new Map([
  ["rail ⌥w", "no handler for widen the rail (#366)"],
  ["rail ⌥s", "no handler for narrow the rail (#366)"],
  ["rail ⌥e", "the card edit mode has no rendering in the current shell (#366)"],
  ["thread ⌃r", "no handler for cycle the rail (#366)"],
  ["tree ⌥t", "the tree rail tab is state only, no component renders it (#366)"],
  ["tree ⌥n", "moves a tree selection that is never drawn (#366)"],
  ["tree ⌥p", "moves a tree selection that is never drawn (#366)"],
]);

/** Every `table chord` pair a test pressed and asserted on. */
const exercised = new Set<string>();

/** Every `table chord` pair the cheatsheet tables advertise. */
function advertisedChords(): string[] {
  const chords: string[] = [];

  for (const [table, entries] of Object.entries(CHORD_TABLES)) {
    for (const entry of entries) {
      for (const chord of cheatsheetEntryChords(entry.keys)) chords.push(`${table} ${chord}`);
    }
  }

  return chords;
}

/** Press a cheatsheet chord, wait for `expected` on screen, and record the chord as covered. */
async function pressChord(
  session: PtyTuiSession,
  table: ChordTable,
  chord: string,
  expected: string | ((screen: string) => boolean),
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  const predicate =
    expected instanceof Function ? expected : (screen: string) => screen.includes(expected);
  const screen = await session.pressAndWaitForScreen(cheatsheetChordKeyPress(chord), predicate, {
    what: `the effect of ${chord}`,
    ...options,
  });

  exercised.add(`${table} ${chord}`);

  return screen;
}

/** Press a chord that answers with a toast or prompt, then dismiss it with escape. */
async function pressChordForToast(
  session: PtyTuiSession,
  table: ChordTable,
  chord: string,
  body: string,
  options: PtyScreenWaitOptions = {},
): Promise<void> {
  await pressChord(session, table, chord, body, options);
  await pressEscapeUntilGone(session, body);
}

/** Escape closes toasts, prompts, cards, and overlays; wait for `text` to leave the screen. */
async function pressEscapeUntilGone(session: PtyTuiSession, text: string): Promise<void> {
  await session.pressAndWaitForScreen("escape", (screen) => !screen.includes(text), {
    what: `"${text}" to leave the screen`,
  });
}

let reviewHome: TestReviewHome;

beforeAll(() => {
  if (!PTY_TIER_ENABLED) return;
  reviewHome = createTestReviewHome();
});

afterAll(() => {
  if (!PTY_TIER_ENABLED) return;
  reviewHome.cleanup();
});

describe("thread view chords in a diff review", () => {
  let repo: TestGitRepo;
  let session: PtyTuiSession;
  let reviewId: string;

  beforeAll(async () => {
    if (!PTY_TIER_ENABLED) return;
    const launched = await launchDiffReview(reviewHome, [STORE_CHANGE, OTHER_CHANGE], {
      env: { CUELOOP_EDITOR: reviewHome.createShellScript("unchanged-editor.sh", "exit 0") },
    });

    session = launched.session;
    repo = launched.repo;
    reviewId = launched.review.id;
  });

  afterAll(async () => {
    if (!PTY_TIER_ENABLED) return;
    await session.close();
    repo.cleanup();
  });

  ptyTest("the diff sheet paints the file header and both sides of the change", () => {
    // Assert
    const screen = session.text();

    expect(screen).toContain("src/store.ts");
    expect(screen).toContain("private items = [];");
    expect(screen).toContain("private items = new Map();");
  });

  ptyTest("⌥x rejects the change under the caret and ⌥u restores it", async () => {
    // Act + Assert - the daemon drops the change from the curated working copy, then gets it back
    await pressChordForToast(
      session,
      "diff",
      "⌥x",
      "change rejected - dropped from the working copy",
    );
    const curated = reviewHome.server.core.sessionGet(reviewId).workingCopy;

    expect(curated).toBeDefined();
    expect(curated).not.toContain("new Map()");
    await pressChordForToast(session, "diff", "⌥u", "removal restored");
  });

  ptyTest("⌥X rejects the whole hunk and ⌥u restores it", async () => {
    // Act + Assert
    await pressChordForToast(
      session,
      "diff",
      "⌥X",
      "hunk rejected - dropped from the working copy",
    );
    await pressChordForToast(session, "diff", "⌥u", "removal restored");
  });

  ptyTest("⌥d explains that the split view needs the zoomed layout", async () => {
    // Act + Assert
    await pressChordForToast(session, "diff", "⌥d", "split diff shows when zoomed");
  });

  ptyTest("⌥c folds the file to its band; clicking the band's chevron unfolds it", async () => {
    // Act + Assert - the band stays, the body goes
    await pressChord(
      session,
      "diff",
      "⌥c",
      (screen) => screen.includes("src/store.ts") && !screen.includes("new Map()"),
    );
    // the chevron sits two cells left of the file name
    const band = session.locate("src/store.ts");

    await session.clickAt(band.column - 2, band.row);
    await session.waitForText("new Map()", { what: "the unfolded file body" });
    await session.click("new Map()");
  });

  ptyTest("⌥k starts the guided walk, ] and [ step through files, escape leaves it", async () => {
    // Act + Assert
    await pressChord(session, "diff", "⌥k", "file 1 of 2 · 0 viewed");
    await session.pressAndWaitForScreen(
      "]",
      (screen) => screen.includes("file 2 of 2 · 1 viewed"),
      {
        what: "the walk card for the second file",
      },
    );
    await session.pressAndWaitForScreen(
      "[",
      (screen) => screen.includes("file 1 of 2 · 1 viewed"),
      {
        what: "the walk card back on the first file",
      },
    );
    await pressEscapeUntilGone(session, "file 1 of 2");
  });

  ptyTest("⌃enter opens the send card, arrows change the verdict, escape cancels", async () => {
    // Act + Assert
    await pressChord(session, "thread", "⌃enter", "[Approve]");
    await session.pressAndWaitForScreen("right", (screen) => screen.includes("[Changes]"), {
      what: "the verdict to move right",
    });
    await session.pressAndWaitForScreen("left", (screen) => screen.includes("[Approve]"), {
      what: "the verdict to move back",
    });
    await pressEscapeUntilGone(session, "[Approve]");
  });

  ptyTest("⌃s reports the share failure when the gateway is unreachable", async () => {
    // Act + Assert - the harness puts a failing ssh on PATH, so the toast carries its stderr
    await pressChordForToast(
      session,
      "thread",
      "⌃s",
      `share failed: gateway upload failed: ${OFFLINE_SSH_MESSAGE}`,
      { timeoutMs: 10_000 },
    );
  });

  ptyTest("⌃e hands the diff to the editor; an instant return asks whether to wait", async () => {
    // Act + Assert - an editor that returns at once is treated as a GUI editor, so the tty asks
    await session.pressAndWaitForScreen(
      cheatsheetChordKeyPress("⌃e"),
      (screen) => screen.includes("press Enter to load your edits"),
      { timeoutMs: 15_000, what: "the wait-for-editor prompt on the tty" },
    );
    await session.press("n");
    await session.pressAndWaitForScreen("enter", (screen) => screen.includes("no changes"), {
      timeoutMs: 15_000,
      what: "the no-changes toast after skipping the edit",
    });
    await pressEscapeUntilGone(session, "no changes");
  });

  ptyTest("typed text opens a draft and ⌃enter sends it as a comment", async () => {
    // Act - two comments on two lines
    await session.type("first note");
    await session.waitForText("● first note", { what: "the first draft" });
    await pressChordForToast(session, "thread", "⌃enter", "comment added");
    await session.click("count = 1");
    await session.type("second note");
    await session.waitForText("● second note", { what: "the second draft" });
    await pressChordForToast(session, "thread", "⌃enter", "comment added");

    // Assert - both cards are on screen
    expect(session.text()).toContain("● first note");
    expect(session.text()).toContain("● second note");
  });

  ptyTest("⌥n and ⌥p move the focus between cards", async () => {
    // Act + Assert - the focused card draws a heavy left border
    const screen = await pressChord(session, "rail", "⌥n", (frame) =>
      /┃ ● (first|second) note/.test(frame),
    );
    const [focused, other] = /┃ ● first note/.test(screen)
      ? ["first", "second"]
      : ["second", "first"];

    await pressChord(session, "rail", "⌥n", `┃ ● ${other} note`);
    await pressChord(session, "rail", "⌥p", `┃ ● ${focused} note`);
  });

  ptyTest("⌥r on your own card explains there is nothing to rename", async () => {
    // Act + Assert
    await pressChordForToast(session, "rail", "⌥r", "that is your own note - nothing to rename");
  });

  ptyTest("⌥⌫ deletes the focused card", async () => {
    // Arrange
    await pressChord(session, "rail", "⌥n", (screen) => /┃ ● (first|second) note/.test(screen));

    // Act + Assert
    await pressChordForToast(session, "rail", "⌥⌫", "annotation deleted");
  });

  ptyTest("the tree chords label, branch, go, fork, and fork-share the history", async () => {
    // Act + Assert - each chord answers with its prompt or toast
    await pressChordForToast(session, "tree", "⌥l", "Name for this checkpoint:");
    await pressChordForToast(session, "tree", "⌥b", "Name for the new branch:");
    await pressChordForToast(session, "tree", "⌥g", "already at the tip");
    await pressChordForToast(session, "tree", "⌥f", "you are on the fork now", {
      timeoutMs: 10_000,
    });
    await pressChordForToast(
      session,
      "tree",
      "⌥h",
      `fork and share failed: gateway upload failed: ${OFFLINE_SSH_MESSAGE}`,
      { timeoutMs: 10_000 },
    );
  });
});

describe("thread view chords in a plan review", () => {
  let session: PtyTuiSession;

  beforeAll(async () => {
    if (!PTY_TIER_ENABLED) return;
    session = (
      await launchPlanReview(reviewHome, {
        env: { CUELOOP_EDITOR: reviewHome.createAppendingEditor(EDIT_MARKER) },
      })
    ).session;
  });

  afterAll(async () => {
    if (!PTY_TIER_ENABLED) return;
    await session.close();
  });

  ptyTest("⌥x cuts the block under the caret and ⌥u restores it", async () => {
    // Arrange - the caret on the first paragraph
    await session.press("down");
    await session.press("down");

    // Act + Assert
    await pressChordForToast(session, "rail", "⌥x", "block cut");
    await pressChord(session, "rail", "⌥u", ROLLOUT_PLAN_LAST_LINE);
  });

  ptyTest("⌃e hands the plan to the editor and resumes with its edit", async () => {
    // Act + Assert
    await pressChord(session, "thread", "⌃e", EDIT_MARKER, { timeoutMs: 15_000 });
  });
});

describe("chord coverage", () => {
  ptyTest(
    "every chord the cheatsheet advertises has a PTY expectation or a documented reason",
    () => {
      // Assert - a chord with neither fails by name
      const missing = advertisedChords().filter(
        (chord) => !exercised.has(chord) && !UNWIRED_CHORDS.has(chord),
      );
      const stale = [...UNWIRED_CHORDS.keys()].filter((chord) => exercised.has(chord));

      expect(missing, `no PTY expectation registered for: ${missing.join(", ")}`).toEqual([]);
      expect(stale, `unwired entries that a test now exercises: ${stale.join(", ")}`).toEqual([]);
    },
  );
});
