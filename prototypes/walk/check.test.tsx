/** Smoke: wizard steps with ], marks viewed, ends offering submit. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./wizard";

describe("guided walk wizard", () => {
  test("] advances marking viewed; end card offers submit; esc leaves keeping progress", async () => {
    const setup = await testRender(<App onExit={() => {}} />, { width: 120, height: 36 });
    const until = async (needle: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
        await Bun.sleep(20);
        await setup.renderOnce();
      }
      expect(setup.captureCharFrame()).toContain(needle);
    };
    await until("file 1 of 5 · 0 viewed");
    setup.mockInput.typeText("]");
    await until("file 2 of 5 · 1 viewed");
    setup.mockInput.typeText("]");
    await until("file 3 of 5 · 2 viewed");

    // leaving keeps progress; resuming returns to the wizard
    setup.mockInput.pressKey("ESCAPE");
    await until("w resumes the walk");
    setup.mockInput.pressKey("w");
    await until("file 3 of 5 · 2 viewed");

    setup.mockInput.typeText("]");
    setup.mockInput.typeText("]");
    setup.mockInput.typeText("]");
    await until("walk complete");
    await until("every file viewed (5/5)");
    setup.mockInput.pressKey("RETURN");
    await until("review submitted");
  }, 20_000);
});
