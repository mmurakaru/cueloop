/**
 * PTY keybinding suite: the thread view's nav mode, pressed as the bytes a
 * terminal sends, against the real TUI. In a live review a bare letter types a
 * comment, so the structural commands live behind esc: press esc to enter nav
 * mode (the footer reads NAV), then a bare letter acts on the session, a
 * discussion, the tree, or a diff row. Bare keys are used throughout so no
 * multiplexer prefix or OS shortcut can intercept them. Env-gated behind
 * CUELOOP_RUN_PTY (`bun run test:pty`).
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import type { TestGitRepo } from "../helpers/git-repo";
import { cheatsheetChordKeyPress, cheatsheetChordKeyPresses } from "../helpers/pty-key-codes";
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

/** Enter nav mode: esc heads there, and the footer shows NAV once it owns the keys. */
async function enterNav(session: PtyTuiSession): Promise<void> {
  await session.pressAndWaitForScreen("escape", (screen) => screen.includes("NAV"), {
    what: "nav mode",
  });
}

/** Enter nav mode, press a bare command key, and wait for its effect on screen. */
async function navPress(
  session: PtyTuiSession,
  chord: string,
  expected: string | ((screen: string) => boolean),
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  const predicate =
    expected instanceof Function ? expected : (screen: string) => screen.includes(expected);

  await enterNav(session);
  const presses = cheatsheetChordKeyPresses(chord);

  for (const press of presses.slice(0, -1)) await session.press(press);

  return session.pressAndWaitForScreen(presses.at(-1)!, predicate, {
    what: `the effect of nav ${chord}`,
    ...options,
  });
}

/**
 * Press a bare nav key while already in nav mode, without the escape that navPress
 * uses to enter it - escape drops the focused card, so cycling focus (n/p) or acting
 * on it (backspace) must stay in nav across the presses.
 */
async function navStep(
  session: PtyTuiSession,
  chord: string,
  expected: string | ((screen: string) => boolean),
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  const predicate =
    expected instanceof Function ? expected : (screen: string) => screen.includes(expected);
  const presses = cheatsheetChordKeyPresses(chord);

  for (const press of presses.slice(0, -1)) await session.press(press);

  return session.pressAndWaitForScreen(presses.at(-1)!, predicate, {
    what: `the effect of nav ${chord} in place`,
    ...options,
  });
}

/** Press a nav command that answers with a toast or prompt, then dismiss it with escape. */
async function navPressForToast(
  session: PtyTuiSession,
  chord: string,
  body: string,
  options: PtyScreenWaitOptions = {},
): Promise<void> {
  await navPress(session, chord, body, options);
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

  ptyTest("esc shows the NAV footer; typing a letter returns to composing a comment", async () => {
    await enterNav(session);
    // a bare letter with no diff command leaves nav and seeds a draft
    await session.pressAndWaitForScreen("w", (screen) => screen.includes("● w"), {
      what: "a draft seeded by typing in nav mode",
    });
    await pressEscapeUntilGone(session, "● w");
  });

  ptyTest("x rejects the change under the caret and u restores it", async () => {
    await navPressForToast(session, "x", "change rejected - dropped from the working copy");
    const curated = reviewHome.server.core.sessionGet(reviewId).workingCopy;

    expect(curated).toBeDefined();
    expect(curated).not.toContain("new Map()");
    await navPressForToast(session, "u", "removal restored");
  });

  ptyTest("X rejects the whole hunk and u restores it", async () => {
    await navPressForToast(session, "X", "hunk rejected - dropped from the working copy");
    await navPressForToast(session, "u", "removal restored");
  });

  ptyTest("d toggles the diff layout and warns that split needs the wide pane", async () => {
    await navPress(session, "d", "stacked diff");
    await navPressForToast(session, "d", "split diff shows when zoomed");
  });

  ptyTest("c folds the file to its band; clicking the band's chevron unfolds it", async () => {
    await navPress(
      session,
      "c",
      (screen) => screen.includes("src/store.ts") && !screen.includes("new Map()"),
    );
    const band = session.locate("src/store.ts");

    await session.clickAt(band.column - 2, band.row);
    await session.waitForText("new Map()", { what: "the unfolded file body" });
    await session.click("new Map()");
  });

  ptyTest("k starts the guided walk, ] and [ step through files, escape leaves it", async () => {
    await navPress(session, "k", "file 1 of 2 · 0 viewed");
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

  ptyTest("enter opens the send card, arrows change the verdict, escape cancels", async () => {
    await navPress(session, "enter", "[Approve]");
    await session.pressAndWaitForScreen("right", (screen) => screen.includes("[Changes]"), {
      what: "the verdict to move right",
    });
    await session.pressAndWaitForScreen("left", (screen) => screen.includes("[Approve]"), {
      what: "the verdict to move back",
    });
    await pressEscapeUntilGone(session, "[Approve]");
  });

  ptyTest("s opens the share dialog; creating a link reports the gateway failure", async () => {
    await navPress(session, "s", "+ new link");
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
    await enterNav(session);
    await session.pressAndWaitForScreen(
      "e",
      (screen) => screen.includes("press Enter to load your edits"),
      {
        timeoutMs: 15_000,
        what: "the wait-for-editor prompt on the tty",
      },
    );
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

    const screen = await navPress(session, "n", (frame) => /┃ ● (first|second) note/.test(frame));
    const [focused, other] = /┃ ● first note/.test(screen)
      ? ["first", "second"]
      : ["second", "first"];

    await navStep(session, "n", `┃ ● ${other} note`);
    await navStep(session, "p", `┃ ● ${focused} note`);
  });

  ptyTest("backspace deletes the focused card", async () => {
    await navPress(session, "n", (screen) => /┃ ● (first|second) note/.test(screen));
    await navStep(session, "⌫", "annotation deleted");
    await pressEscapeUntilGone(session, "annotation deleted");
  });
});

describe("nav mode in a plan review", () => {
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

  ptyTest("x cuts the block under the caret and u restores it", async () => {
    await session.press("down");
    await session.press("down");
    await navPressForToast(session, "x", "block cut");
    await navPress(session, "u", ROLLOUT_PLAN_LAST_LINE);
  });

  ptyTest("e hands the plan to the editor and resumes with its edit", async () => {
    await navPress(session, "e", EDIT_MARKER, { timeoutMs: 15_000 });
  });

  ptyTest("the tree commands label, branch, go, fork, and fork-share the history", async () => {
    await navPressForToast(session, "l", "Name for this checkpoint:");
    await navPressForToast(session, "b", "Name for the new branch:");
    await navPressForToast(session, "g", "already at the tip");
    await navPressForToast(session, "f", "you are on the fork now", { timeoutMs: 10_000 });
    await navPressForToast(session, "h", "fork and share failed: gateway upload failed:", {
      timeoutMs: 10_000,
    });
  });
});
