import { describe, expect, test } from "bun:test";
import { detectHerdr, insideHerdr, returnPaneFor } from "./herdr";

describe("detectHerdr", () => {
  test("null outside herdr, context inside", () => {
    expect(detectHerdr({})).toBeNull();
    expect(detectHerdr({ HERDR_ENV: "1", HERDR_PANE_ID: "p1" })).toBeNull();
    expect(detectHerdr({ HERDR_ENV: "1", HERDR_PANE_ID: "p1", HERDR_BIN_PATH: "/x/herdr" })).toEqual({
      paneId: "p1",
      binPath: "/x/herdr",
    });
  });
});

describe("insideHerdr", () => {
  test("true only when HERDR_ENV is exactly 1", () => {
    expect(insideHerdr({})).toBeFalse();
    expect(insideHerdr({ HERDR_ENV: "0" })).toBeFalse();
    expect(insideHerdr({ HERDR_ENV: "1" })).toBeTrue();
  });
});

describe("returnPaneFor", () => {
  test("outside herdr there is never a return target", () => {
    expect(returnPaneFor("w1:p1", {})).toBeUndefined();
  });

  test("env override wins, session meta is the fallback", () => {
    // Arrange
    const inside = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p9" };

    // Assert
    expect(returnPaneFor("w1:p1", inside)).toBe("w1:p1");
    expect(returnPaneFor("w1:p1", { ...inside, CUELOOP_RETURN_PANE: "w1:p2" })).toBe("w1:p2");
  });

  test("returning to our own pane is a no-op", () => {
    expect(returnPaneFor("w1:p1", { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" })).toBeUndefined();
  });
});
