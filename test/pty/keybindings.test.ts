/**
 * PTY keybinding suite: the thread view's nav mode, pressed as the bytes a
 * terminal sends, against the real TUI. In a live review a bare letter types a
 * comment, so the structural commands live behind esc: press esc to enter nav
 * mode (the footer shows the nav commands), then a bare letter acts on the session, a
 * discussion, the tree, or a diff row. The grammar under test is the command tables
 * in thread-chords.ts - the same tables the keybinds dialog renders. The last test
 * enumerates those tables and fails on any command without a screen-level
 * expectation, so a new command cannot ship unproven. Coverage is collected while
 * the earlier tests run, so the tier is serial and a single test run in isolation
 * reports every command as missing. Env-gated behind CUELOOP_RUN_PTY (`bun run test:pty`).
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  curationCommandEntries,
  diffCommandEntries,
  sessionCommandEntries,
  treeCommandEntries,
} from "../../packages/client/src/thread-chords";
import type { TestGitRepo } from "../helpers/git-repo";
import {
  cheatsheetChordKeyPress,
  cheatsheetChordKeyPresses,
  cheatsheetEntryChords,
} from "../helpers/pty-key-codes";
import {
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

/** The command tables the keybinds dialog renders, by the name the coverage test reports. */
const COMMAND_TABLES = {
  session: sessionCommandEntries(),
  diff: diffCommandEntries(),
  discussion: curationCommandEntries(),
  tree: treeCommandEntries(),
} as const;

type CommandTable = keyof typeof COMMAND_TABLES;

/** Every `table key` pair a test pressed and asserted on. */
const exercised = new Set<string>();

/** Every `table key` pair the command tables advertise. */
function advertisedCommands(): string[] {
  const commands: string[] = [];

  for (const [table, entries] of Object.entries(COMMAND_TABLES)) {
    for (const entry of entries) {
      for (const key of cheatsheetEntryChords(entry.keys)) commands.push(`${table} ${key}`);
    }
  }

  return commands;
}

/** Enter nav mode: esc heads there, and the footer shows the nav commands (with "⏎ submit"). */
async function enterNav(session: PtyTuiSession): Promise<void> {
  // "⏎ submit" sits in both nav footers before the pane's right edge; the compose footer never has it
  await session.pressAndWaitForScreen("escape", (screen) => screen.includes("⏎ submit"), {
    what: "nav mode",
  });
}

/** Enter nav mode, press a bare command key, wait for its effect on screen, and record it as covered. */
async function navPress(
  session: PtyTuiSession,
  table: CommandTable,
  key: string,
  expected: string | ((screen: string) => boolean),
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  await enterNav(session);

  return navStep(session, table, key, expected, options);
}

/**
 * Press a bare nav key while already in nav mode, without the escape that navPress
 * uses to enter it - escape drops the focused card, so cycling focus (n/p) or acting
 * on it (backspace) must stay in nav across the presses.
 */
async function navStep(
  session: PtyTuiSession,
  table: CommandTable,
  key: string,
  expected: string | ((screen: string) => boolean),
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  const predicate =
    expected instanceof Function ? expected : (screen: string) => screen.includes(expected);
  const presses = cheatsheetChordKeyPresses(key);

  for (const press of presses.slice(0, -1)) await session.press(press);
  const screen = await session.pressAndWaitForScreen(presses.at(-1)!, predicate, {
    what: `the effect of nav ${key}`,
    ...options,
  });

  exercised.add(`${table} ${key}`);

  return screen;
}

/** Press a nav command that answers with a toast or prompt, then dismiss it with escape. */
async function navPressForToast(
  session: PtyTuiSession,
  table: CommandTable,
  key: string,
  body: string,
  options: PtyScreenWaitOptions = {},
): Promise<void> {
  await navPress(session, table, key, body, options);
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

describe("nav mode in a diff review", () => {
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
    const screen = session.text();

    expect(screen).toContain("src/store.ts");
    expect(screen).toContain("private items = [];");
    expect(screen).toContain("private items = new Map();");
  });

  ptyTest("esc shows the nav footer; typing a letter returns to composing a comment", async () => {
    await enterNav(session);
    // a bare letter with no diff command leaves nav and seeds a draft
    await session.pressAndWaitForScreen("w", (screen) => screen.includes("● w"), {
      what: "a draft seeded by typing in nav mode",
    });
    await pressEscapeUntilGone(session, "● w");
  });

  ptyTest("x rejects the change under the caret and u restores it", async () => {
    await navPressForToast(session, "diff", "x", "change rejected - dropped from the working copy");
    const curated = reviewHome.server.core.sessionGet(reviewId).workingCopy;

    expect(curated).toBeDefined();
    expect(curated).not.toContain("new Map()");
    await navPressForToast(session, "diff", "u", "removal restored");
  });

  ptyTest("d toggles the diff layout and warns that split needs the wide pane", async () => {
    await navPress(session, "diff", "d", "stacked diff");
    await navPressForToast(session, "diff", "d", "split diff shows when zoomed");
  });

  ptyTest("c folds the file to its band; clicking the band's chevron unfolds it", async () => {
    await navPress(
      session,
      "diff",
      "c",
      (screen) => screen.includes("src/store.ts") && !screen.includes("new Map()"),
    );
    const band = session.locate("src/store.ts");

    await session.clickAt(band.column - 2, band.row);
    await session.waitForText("new Map()", { what: "the unfolded file body" });
    await session.click("new Map()");
  });

  ptyTest("k starts the guided walk, ] and [ step through files, escape leaves it", async () => {
    await navPress(session, "diff", "k", "file 1 of 2 · 0 viewed");
    await session.pressAndWaitForScreen(
      "]",
      (screen) => screen.includes("file 2 of 2 · 1 viewed"),
      { what: "the walk card for the second file" },
    );
    await session.pressAndWaitForScreen(
      "[",
      (screen) => screen.includes("file 1 of 2 · 1 viewed"),
      { what: "the walk card back on the first file" },
    );
    await pressEscapeUntilGone(session, "file 1 of 2");
  });

  ptyTest("enter opens the send card, arrows change the message, escape cancels", async () => {
    await navPress(session, "session", "⏎", "[Approve]");
    await session.pressAndWaitForScreen("right", (screen) => screen.includes("[Changes]"), {
      what: "the message to move right",
    });
    await session.pressAndWaitForScreen("left", (screen) => screen.includes("[Approve]"), {
      what: "the message to move back",
    });
    await pressEscapeUntilGone(session, "[Approve]");
  });

  ptyTest("s opens the share dialog; creating a link reports the gateway failure", async () => {
    await navPress(session, "session", "s", "+ new link");
    await session.press("enter");
    await session.pressAndWaitForScreen("enter", (screen) => screen.includes("link name"), {
      what: "the new-link wizard",
    });
    const failure = `share failed: gateway upload failed: ${OFFLINE_SSH_MESSAGE}`;

    await session.pressAndWaitForScreen("enter", (screen) => screen.includes(failure), {
      timeoutMs: 10_000,
      what: "the share failure toast after creating the link",
    });
    await pressEscapeUntilGone(session, failure);
  });

  ptyTest("e hands the diff to the editor; an instant return asks whether to wait", async () => {
    await navPress(session, "session", "e", "press Enter to load your edits", {
      timeoutMs: 15_000,
      what: "the wait-for-editor prompt on the tty",
    });
    await session.press("n");
    await session.pressAndWaitForScreen("enter", (screen) => screen.includes("no changes"), {
      timeoutMs: 15_000,
      what: "the no-changes toast after skipping the edit",
    });
    await pressEscapeUntilGone(session, "no changes");
  });

  ptyTest("n and p move the focus between cards", async () => {
    // a click leaves any inherited nav mode and places the caret on a real diff row
    const send = cheatsheetChordKeyPress("⌃enter");

    await session.click("new Map()");
    await session.type("first note");
    await session.waitForText("● first note", { what: "the first draft" });
    await session.pressAndWaitForScreen(send, (screen) => !screen.includes("enter save"), {
      what: "the first comment saved",
    });
    await session.click("count = 1");
    await session.type("second note");
    await session.waitForText("● second note", { what: "the second draft" });
    await session.pressAndWaitForScreen(send, (screen) => !screen.includes("enter save"), {
      what: "the second comment saved",
    });

    const screen = await navPress(session, "discussion", "n", (frame) =>
      /┃ ● (first|second) note/.test(frame),
    );
    const [focused, other] = /┃ ● first note/.test(screen)
      ? ["first", "second"]
      : ["second", "first"];

    await navStep(session, "discussion", "n", `┃ ● ${other} note`);
    await navStep(session, "discussion", "p", `┃ ● ${focused} note`);
  });

  ptyTest("z folds the card under the caret to its summary and unfolds it again", async () => {
    await navPress(session, "discussion", "z", "○ 1 comment ›");
    await navStep(session, "discussion", "z", (screen) => !screen.includes("○ 1 comment ›"));
  });

  ptyTest("backspace deletes the focused card", async () => {
    await navPress(session, "discussion", "n", (screen) => /┃ ● (first|second) note/.test(screen));
    await navStep(session, "discussion", "⌫", "annotation deleted");
    await pressEscapeUntilGone(session, "annotation deleted");
  });
});

describe("nav mode in a plan review", () => {
  let session: PtyTuiSession;

  beforeAll(async () => {
    if (!PTY_TIER_ENABLED) return;
    session = (await launchPlanReview(reviewHome)).session;
  });

  afterAll(async () => {
    if (!PTY_TIER_ENABLED) return;
    await session.close();
  });

  ptyTest("x cuts the block under the caret and u restores it", async () => {
    await session.press("down");
    await session.press("down");
    await navPressForToast(session, "discussion", "x", "block cut");
    await navPress(session, "discussion", "u", ROLLOUT_PLAN_LAST_LINE);
  });

  ptyTest("r with no collaborator note focused explains there is nothing to rename", async () => {
    await navPressForToast(session, "discussion", "r", "that is your own note - nothing to rename");
  });

  ptyTest(
    "e opens the inline editor; typed text edits the body and ctrl+enter saves it",
    async () => {
      await navPress(session, "session", "e", "save & close", { timeoutMs: 15_000 });
      await session.type("EDITOK ");
      await session.pressAndWaitForScreen(
        cheatsheetChordKeyPress("⌃enter"),
        (screen) => screen.includes("EDITOK") && !screen.includes("save & close"),
        { timeoutMs: 15_000, what: "the saved edit in the read-only view" },
      );
    },
  );

  ptyTest("the tree commands label, branch, go, fork, and fork-share the history", async () => {
    await navPressForToast(session, "tree", "l", "Name for this checkpoint:");
    await navPressForToast(session, "tree", "b", "Name for the new branch:");
    await navPressForToast(session, "tree", "g", "already at the tip");
    await navPressForToast(session, "tree", "f", "you are on the fork now", { timeoutMs: 10_000 });
    await navPressForToast(session, "tree", "h", "fork and share failed: gateway upload failed:", {
      timeoutMs: 10_000,
    });
  });
});

describe("nav command coverage", () => {
  ptyTest("every command the keybinds dialog advertises has a PTY expectation", () => {
    const missing = advertisedCommands().filter((command) => !exercised.has(command));

    expect(missing, `no PTY expectation registered for: ${missing.join(", ")}`).toEqual([]);
  });
});
