/** Smoke v2: keyboard drives the NATIVE selection; c captures the quote. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./select";

describe("selection primitive (native)", () => {
  test("v anchors native selection, l extends, c comments with the quote", async () => {
    const setup = await testRender(<App onExit={() => {}} />, { width: 120, height: 30 });
    const until = async (needle: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
        await Bun.sleep(20);
        await setup.renderOnce();
      }
      expect(setup.captureCharFrame()).toContain(needle);
    };
    await until("drag or v to select");
    await until("select a span and press c");

    // cursor starts at line 3 word 0 ("Review"); anchor + extend two words
    setup.mockInput.pressKey("v");
    await until("extending selection");
    setup.mockInput.pressKey("l");
    await Bun.sleep(30);
    await setup.renderOnce();
    setup.mockInput.pressKey("l");
    await Bun.sleep(30);
    await setup.renderOnce();
    setup.mockInput.pressKey("c");
    await until("comment on");
    setup.mockInput.typeText("scope this");
    await until("scope this");
    setup.mockInput.pressKey("RETURN");
    await until("Review (1)");
    await until("annotation saved");
  }, 20_000);
});
