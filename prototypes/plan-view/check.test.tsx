/** Smoke: plan renders, Edit toggles to Done, editing a quoted line orphans a note. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./plan";

describe("plan view + edit switch", () => {
  test("normal renders rail; edit toggle; edit a quoted line orphans its note", async () => {
    const setup = await testRender(<App onExit={() => {}} rows={40} />, { width: 130, height: 40 });
    const until = async (needle: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
        await Bun.sleep(20);
        await setup.renderOnce();
      }
      expect(setup.captureCharFrame()).toContain(needle);
    };
    await until("Implementation Plan");
    await until("Review (4)");
    await until("BLOCKING");
    await until(" Edit ");

    // enter edit mode -> the toggle reads Done
    setup.mockInput.pressKey("e");
    await until(" Done ");
    await until("editing plan source");

    // move to the "atomic rename" line (index 9) and delete it
    for (let i = 0; i < 9; i++) {
      setup.mockInput.pressKey("j");
      await Bun.sleep(8);
      await setup.renderOnce();
    }
    setup.mockInput.pressKey("d");
    await Bun.sleep(20);
    await setup.renderOnce();

    // commit -> reconciliation banner + the blocking issue orphaned
    setup.mockInput.pressKey("ESCAPE");
    await until("no longer match");
    await until("ORPHANED");
  }, 30_000);
});
