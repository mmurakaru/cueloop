/** Regressions from the focus/perf round: ctrl+q must quit from any keyboard state, and clicking a
 * sidebar thread must give it the selected accent at once (the cursor follows the click). */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import { App } from "./App";
import {
  clickText,
  isolateUserConfig,
  pressKey,
  renderReadyApp,
  waitForText,
} from "./test-support";

const ACCENT_DARK: [number, number, number] = [203, 166, 247];

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;

function plan(title: string): void {
  server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: `# ${title}\n`, meta: { title, planPath: "plan.md" } },
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-regression-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  plan("First review");
  plan("Second review");
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

/** The text of the sidebar title span currently painted in the accent colour, or undefined. */
function accentTitle(setup: Awaited<ReturnType<typeof renderReadyApp>>): string | undefined {
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      const rgb = span.fg?.toInts();
      if (
        rgb &&
        rgb[0] === ACCENT_DARK[0] &&
        rgb[1] === ACCENT_DARK[1] &&
        rgb[2] === ACCENT_DARK[2]
      ) {
        const text = span.text.trim();
        if (text.includes("review")) return text;
      }
    }
  }

  return undefined;
}

test("ctrl+q quits even when a menu holds the keyboard", async () => {
  let exitCode: number | undefined;
  const setup = await renderReadyApp(<App home={home} onExit={(code) => (exitCode = code)} />, {
    width: 120,
    height: 32,
  });
  await waitForText(setup, "review");

  // open the settings dialog from the top-left gear - it takes the keyboard
  await setup.mockMouse.click(1, 0);
  await waitForText(setup, "Keybinds");

  await pressKey(setup, "q", { ctrl: true });

  expect(exitCode).toBe(0);
  setup.renderer.destroy();
});

test("clicking a sidebar thread gives it the selected accent at once", async () => {
  const setup = await renderReadyApp(<App home={home} />, { width: 120, height: 32 });
  await waitForText(setup, "Second review");

  // click whichever thread is not already the selected (accent) one
  const target = accentTitle(setup)?.includes("Second") ? "First review" : "Second review";
  await clickText(setup, target);

  expect(accentTitle(setup)).toContain(target.split(" ")[0]!);
  setup.renderer.destroy();
});
