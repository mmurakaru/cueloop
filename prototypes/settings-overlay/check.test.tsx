/** Smoke: overlay opens, nav moves, a toggle flips, esc closes. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./settings";

describe("settings overlay", () => {
  test("open, navigate, toggle a value, close", async () => {
    const setup = await testRender(<App onExit={() => {}} />, { width: 120, height: 40 });
    const until = async (needle: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
        await Bun.sleep(20);
        await setup.renderOnce();
      }
      expect(setup.captureCharFrame()).toContain(needle);
    };
    await until("Implementation Plan");
    await until("Feedback");
    await until("Select");

    setup.mockInput.pressKey(",");
    await until("SETTINGS");
    await until("General");
    await until("identity and submission");

    // into Display category (2 downs), then into body, flip line numbers
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("j");
    await until("plan width and chrome");
    setup.mockInput.pressKey("l");
    await Bun.sleep(30);
    await setup.renderOnce();
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("space");
    await until("Line numbers");

    setup.mockInput.pressKey("ESCAPE");
    await Bun.sleep(40);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("plan width and chrome");
  }, 20_000);
});
