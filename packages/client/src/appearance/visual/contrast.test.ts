import { expect, test } from "bun:test";
import { themeForName } from "../theme-presets";
import { contrastRatio, relativeLuminance, rgbColorFromHex } from "./contrast";

test("relativeLuminance ranks black below white", () => {
  expect(relativeLuminance([0, 0, 0])).toBe(0);
  expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
});

test("contrastRatio is symmetric and peaks at black on white", () => {
  expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 0);
  expect(contrastRatio([100, 100, 100], [100, 100, 100])).toBeCloseTo(1, 5);
});

// The branded theme is terminal-through, so text sits on a real terminal background, not pure black or
// white; gate each theme against a representative one so a low-contrast token cannot hide behind an extreme.
const TERMINAL_BACKGROUND = {
  dark: rgbColorFromHex("#1e1e2e"),
  light: rgbColorFromHex("#f0f0f0"),
} as const;
const MIN_NORMAL_TEXT_CONTRAST = 4.5;

for (const mode of ["dark", "light"] as const) {
  test(`${mode} theme keeps text, muted text, and accent legible on its terminal`, () => {
    const theme = themeForName("cueloop", mode);
    const background = TERMINAL_BACKGROUND[mode];

    for (const token of [theme.text, theme.textMuted, theme.accent]) {
      expect(contrastRatio(rgbColorFromHex(token), background)).toBeGreaterThanOrEqual(
        MIN_NORMAL_TEXT_CONTRAST,
      );
    }
  });
}
