/** Scene visual regression: the workbench rendered in both themes. Clicking a sidebar thread must paint
 * its title in that theme's accent - proving the theme applied and the click feedback works in dark and
 * light. Colours come from captureSpans, so a theme regression fails here even though char text is equal. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import { App } from "./App";
import { clickText, isolateUserConfig, renderReadyApp, waitForText } from "./test-support";
import { themeForName } from "./theme-presets";
import { rgbFromHex } from "./visual/contrast";

let home: string;
let restore: () => void;
let server: DaemonServer;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-visual-"));
  restore = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# First review\n", meta: { title: "First review" } },
  });
  server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Second review\n", meta: { title: "Second review" } },
  });
});
afterEach(() => {
  restore();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

/** Whether any span containing `needle` is painted in `color` (the thread header also carries the title
 *  in a dim colour, so we look for the accent row rather than the first match). */
function hasSpanColor(
  setup: Awaited<ReturnType<typeof renderReadyApp>>,
  needle: string,
  color: readonly [number, number, number],
): boolean {
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle) || !span.fg) continue;
      const [red, green, blue] = span.fg.toInts();
      if (red === color[0] && green === color[1] && blue === color[2]) return true;
    }
  }

  return false;
}

for (const mode of ["dark", "light"] as const) {
  test(`clicking a thread paints it in the ${mode} accent`, async () => {
    const accent = rgbFromHex(themeForName("cueloop", mode).accent);
    const setup = await renderReadyApp(<App home={home} appearance={mode} />, {
      width: 120,
      height: 32,
    });
    await waitForText(setup, "Second review");

    await clickText(setup, "Second review");

    expect(hasSpanColor(setup, "Second review", accent)).toBe(true);
    setup.renderer.destroy();
  });
}
