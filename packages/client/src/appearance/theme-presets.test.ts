/** The branded transparent theme adapts to the terminal background - a light terminal gets dark text instead of light-on-light - while the opaque palette presets ignore appearance. */

import { describe, expect, test } from "bun:test";
import { DARK, LIGHT } from "./theme";
import { composeTheme, themeForName } from "./theme-presets";

describe("themeForName appearance", () => {
  test("the branded cueloop theme picks the light variant on a light terminal", () => {
    // Assert
    expect(themeForName("cueloop", "dark")).toBe(DARK);
    expect(themeForName("cueloop", "light")).toBe(LIGHT);
  });

  test("defaults to the dark variant when appearance is unspecified", () => {
    // Assert
    expect(themeForName("cueloop")).toBe(DARK);
  });

  test("an unknown name falls back to the branded theme, still appearance-aware", () => {
    // Assert
    expect(themeForName("nope", "light")).toBe(LIGHT);
    expect(themeForName("nope", "dark")).toBe(DARK);
  });

  test("an explicit opaque preset ignores appearance (it paints its own background)", () => {
    // Assert
    expect(themeForName("nord", "light")).toBe(themeForName("nord", "dark"));
  });
});

describe("the branded variants", () => {
  test("both keep the transparent background but the light variant darkens its text", () => {
    // Assert
    expect(DARK.background).toBe("transparent");
    expect(LIGHT.background).toBe("transparent");
    expect(LIGHT.text).toBe("#1c1d24");
    expect(LIGHT.text).not.toBe(DARK.text);
    expect(LIGHT.elevated).not.toBe(DARK.elevated);
  });
});

describe("composeTheme", () => {
  test("resolves the appearance base, then layers per-token overrides on top", () => {
    // Act
    const themed = composeTheme("cueloop", { accent: "#123456" }, "light");

    // Assert
    expect(themed.text).toBe(LIGHT.text);
    expect(themed.accent).toBe("#123456");
  });
});
