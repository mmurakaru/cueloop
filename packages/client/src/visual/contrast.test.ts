import { expect, test } from "bun:test";
import { themeForName } from "../theme-presets";
import { contrastRatio, relativeLuminance, rgbFromHex } from "./contrast";

test("relativeLuminance ranks black below white", () => {
  expect(relativeLuminance([0, 0, 0])).toBe(0);
  expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
});

test("contrastRatio is symmetric and peaks at black on white", () => {
  expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 0);
  expect(contrastRatio([100, 100, 100], [100, 100, 100])).toBeCloseTo(1, 5);
});

// The branded theme is terminal-through, so text sits on the terminal's own background: darkest for a
// dark terminal, lightest for a light one. Each theme's text must stay legible against that extreme.
const TERMINAL_BACKGROUND = { dark: rgbFromHex("#000000"), light: rgbFromHex("#ffffff") } as const;
const MIN_TEXT_CONTRAST = 4.5;
const MIN_ACCENT_CONTRAST = 3;

for (const mode of ["dark", "light"] as const) {
  test(`${mode} theme keeps text and accent legible on its terminal`, () => {
    const theme = themeForName("cueloop", mode);
    const background = TERMINAL_BACKGROUND[mode];

    expect(contrastRatio(rgbFromHex(theme.text), background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(rgbFromHex(theme.textMuted), background)).toBeGreaterThanOrEqual(
      MIN_ACCENT_CONTRAST,
    );
    expect(contrastRatio(rgbFromHex(theme.accent), background)).toBeGreaterThanOrEqual(
      MIN_ACCENT_CONTRAST,
    );
  });
}
