/**
 * PTY tests: the real `cueloop` TUI in a pseudo-terminal, asserting what the
 * virtual-terminal tier cannot prove - alternate-screen render, key routing
 * through a raw tty, typed input, SIGWINCH resize, and the exit code. The
 * chord grammar is covered in keybindings.test.ts. Output is fed into the
 * Ghostty VT emulator, so every assertion reads the rendered screen
 * (test/helpers/pty-tui-session.ts). Env-gated behind CUELOOP_RUN_PTY
 * (`bun run test:pty`); the tests share one session and run in file order.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { launchPlanReview, PTY_TIER_ENABLED, ptyTest } from "../helpers/pty-reviews";
import type { PtyTuiSession } from "../helpers/pty-tui-session";
import { createTestReviewHome, type TestReviewHome } from "../helpers/review-home";

let reviewHome: TestReviewHome;
let session: PtyTuiSession;

beforeAll(async () => {
  if (!PTY_TIER_ENABLED) return;
  reviewHome = createTestReviewHome();
  session = (await launchPlanReview(reviewHome)).session;
});

afterAll(async () => {
  if (!PTY_TIER_ENABLED) return;
  await session.close();
  reviewHome.cleanup();
});

describe("PTY tier: the real TUI in a pseudo-terminal", () => {
  ptyTest("initial render paints the plan, the header actions, and the footer", () => {
    // Assert - the screen grid holds the title, the body, the header actions, and the footer
    const screen = session.text();

    expect(screen).toContain("Rollout Plan");
    expect(screen).toContain("Ship the daemon behind a flag.");
    expect(screen).toContain("Enable it for everyone immediately.");
    expect(screen).toMatch(/edit\s+share/);
    expect(screen).toContain("repo / main");
  });

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
  );

  // The composer reorders characters that arrive about 1 ms apart (#365); when
  // that is fixed, this proves it: `await session.type("needs a test", 1)` then
  // wait for "● needs a test".
  test.todo("a 1 ms burst of typed characters lands in order (#365)", () => {});

  ptyTest("resize does not crash and the document survives both directions", async () => {
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
  });

  ptyTest("ctrl+q exits cleanly with code 0", async () => {
    // Act
    await session.press(["ctrl", "q"]);

    // Assert
    const exit = await session.waitForExit(10_000);

    expect(exit.exitCode).toBe(0);
  });
});
