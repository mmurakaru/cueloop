/** Scene visual regression: clicking a sidebar thread paints its title in the theme's accent, in both
 * themes. Colours come from captureSpans, so a theme or click-feedback regression fails here. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import React from "react";
import { App } from "./App";
import { clickText, isolateUserConfig, renderReadyApp, waitForText } from "./test-support";
import { themeForName } from "./theme-presets";
import { rgbColorFromHex } from "./visual/contrast";
import { createTestReviewHome, type TestReviewHome } from "../../../test/helpers/review-home";

let reviewHome: TestReviewHome;
let restoreUserConfig: () => void;

beforeEach(() => {
  reviewHome = createTestReviewHome();
  restoreUserConfig = isolateUserConfig(reviewHome.home);
  reviewHome.createPlanSession("# First review\n", "First review");
  reviewHome.createPlanSession("# Second review\n", "Second review");
});
afterEach(() => {
  restoreUserConfig();
  reviewHome.cleanup();
});

/** Whether any span containing `needle` is painted in `color` (the thread header carries the title dimly). */
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
    const accent = rgbColorFromHex(themeForName("cueloop", mode).accent);
    const setup = await renderReadyApp(<App home={reviewHome.home} appearance={mode} />, {
      width: 120,
      height: 32,
    });
    await waitForText(setup, "Second review");

    await clickText(setup, "Second review");

    expect(hasSpanColor(setup, "Second review", accent)).toBe(true);
    setup.renderer.destroy();
  });
}
