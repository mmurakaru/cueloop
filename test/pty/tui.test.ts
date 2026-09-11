/**
 * PTY tests: the real `cueloop` TUI in a pseudo-terminal, asserting what the
 * virtual-terminal tier cannot prove - alternate-screen render, key routing
 * through a raw tty, SIGWINCH resize, the editor hand-off, mouse routing, and
 * the exit code. Output is fed into the Ghostty VT emulator, so every assertion
 * reads the rendered screen (test/helpers/pty-tui-session.ts). Env-gated behind
 * CUELOOP_RUN_PTY (`bun run test:pty`); each describe shares one session and
 * runs in file order.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ReviewSession } from "@cueloop/schema";
import { createTestGitRepo, type TestGitRepo } from "../helpers/git-repo";
import { launchTuiSession, ptyTuiAvailable, type PtyTuiSession } from "../helpers/pty-tui-session";
import { createTestReviewHome, type TestReviewHome } from "../helpers/review-home";

const RUN = !!process.env.CUELOOP_RUN_PTY;
const ptyTest = RUN ? test : test.skip;

// An explicitly requested PTY run must not pass by skipping everything.
if (RUN && !ptyTuiAvailable()) {
  throw new Error(
    "PTY tier requested via CUELOOP_RUN_PTY but the native pty or Ghostty VT shim is missing for this platform",
  );
}

const PLAN = `# Rollout Plan

## Phase 1

Ship the daemon behind a flag.

## Phase 2

Enable it for everyone immediately.
`;

const EDIT_MARKER = "Edited via PTY hand-off.";

let reviewHome: TestReviewHome;

beforeAll(() => {
  if (!RUN) return;
  reviewHome = createTestReviewHome();
});

afterAll(() => {
  if (!RUN) return;
  reviewHome.cleanup();
});

describe("PTY tier: a plan review in a pseudo-terminal", () => {
  let session: PtyTuiSession;

  beforeAll(async () => {
    if (!RUN) return;
    const planSession = reviewHome.createPlanSession(PLAN, "Rollout Plan");

    session = launchTuiSession({
      home: reviewHome.home,
      args: [planSession.id],
      cols: 120,
      rows: 30,
      env: { CUELOOP_EDITOR: reviewHome.createAppendingEditor(EDIT_MARKER) },
    });
    await session.waitForText("Enable it for everyone immediately.", {
      timeoutMs: 20_000,
      what: "the first painted plan",
    });
    // down moves the caret onto the next block (a background change); up moves it back
    await session.ensureKeyboardIsLive("down", "up");
  });

  afterAll(async () => {
    if (!RUN) return;
    await session.close();
  });

  ptyTest(
    "initial render paints the plan, the header actions, and the footer",
    () => {
      // Assert - the screen grid holds the title, the body, the header actions, and the footer
      const screen = session.text();

      expect(screen).toContain("Rollout Plan");
      expect(screen).toContain("Ship the daemon behind a flag.");
      expect(screen).toContain("Enable it for everyone immediately.");
      expect(screen).toMatch(/edit\s+share/);
      expect(screen).toContain("repo / main");
    },
    60_000,
  );

  ptyTest(
    "keys route through the raw tty: arrows move the caret, printables open and fill a draft",
    async () => {
      // Act - two blocks down lands the caret on the first paragraph; a printable opens a draft card
      await session.press("down");
      await session.press("down");
      await session.pressAndWaitForScreen("x", (screen) => screen.includes("● x"), {
        what: "the draft card",
      });

      // Act - typed characters land in the same draft
      await session.type("yz");

      // Assert
      await session.waitForText("● xyz", { what: "the typed draft text" });

      // Act - escape twice drops the draft, then the mark
      await session.press("escape");
      await session.waitForScreen((screen) => !screen.includes("● xyz"), {
        what: "the draft to close",
      });
      await session.press("escape");

      // Assert
      expect(session.exit()).toBeNull();
    },
    60_000,
  );

  ptyTest(
    "resize does not crash and the document survives both directions",
    async () => {
      // Act - shrink, then grow back; SIGWINCH must repaint, not kill
      session.resize(100, 24);
      await session.waitForText("Ship the daemon behind a flag.", {
        what: "the plan after shrinking",
      });
      expect(session.exit()).toBeNull();

      session.resize(120, 30);
      await session.waitForText("Ship the daemon behind a flag.", {
        what: "the plan after growing back",
      });

      // Assert - the screen is the requested size and the child still runs
      expect(session.text().split("\n")).toHaveLength(30);
      expect(session.exit()).toBeNull();
    },
    60_000,
  );

  ptyTest(
    "ctrl+e suspends the renderer, runs the editor on the real tty, and resumes with the edit",
    async () => {
      // Act - the edit hand-off runs the appending editor script against the plan
      await session.pressAndWaitForScreen(["ctrl", "e"], (screen) => screen.includes(EDIT_MARKER), {
        timeoutMs: 15_000,
        what: "the edited plan after resume",
      });

      // Assert - the plan is back with the appended line, and the tty is live again
      expect(session.exit()).toBeNull();
      await session.ensureKeyboardIsLive("down", "up");
    },
    60_000,
  );

  ptyTest(
    "ctrl+q exits cleanly with code 0",
    async () => {
      // Act
      await session.press(["ctrl", "q"]);

      // Assert
      const exit = await session.waitForExit(10_000);

      expect(exit.exitCode).toBe(0);
    },
    60_000,
  );
});

describe("PTY tier: a diff review in a pseudo-terminal", () => {
  let repo: TestGitRepo;
  let diffSession: ReviewSession;
  let session: PtyTuiSession;

  beforeAll(async () => {
    if (!RUN) return;
    repo = createTestGitRepo([
      {
        path: "src/store.ts",
        before: "export class Store {\n  private items = [];\n}\n",
        after: "export class Store {\n  private items = new Map();\n}\n",
      },
    ]);
    const { patch, files } = await repo.diff();

    diffSession = reviewHome.createDiffSession(patch, files);
    session = launchTuiSession({
      home: reviewHome.home,
      args: [diffSession.id],
      cols: 120,
      rows: 30,
    });
    await session.waitForText("new Map()", { timeoutMs: 20_000, what: "the first painted diff" });
  });

  afterAll(async () => {
    if (!RUN) return;
    await session.close();
    repo.cleanup();
  });

  ptyTest(
    "the diff sheet paints the file header and both sides of the change",
    () => {
      // Assert
      const screen = session.text();

      expect(screen).toContain("src/store.ts");
      expect(screen).toContain("private items = [];");
      expect(screen).toContain("private items = new Map();");
    },
    60_000,
  );

  ptyTest(
    "a mouse click routes through the tty, and alt+x rejects the change under the caret",
    async () => {
      // Arrange - the click lands the caret on the added line
      await session.click("new Map()");

      // Act
      await session.pressAndWaitForScreen(
        ["alt", "x"],
        (screen) => screen.includes("change rejected"),
        {
          what: "the rejection toast",
        },
      );

      // Assert - the daemon holds the curated working copy without the change
      expect(reviewHome.server.core.sessionGet(diffSession.id).workingCopy).toBe("");
    },
    60_000,
  );
});
