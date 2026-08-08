/** Headless smoke for variant D: compose in a bordered box, save to rail, cut, edit. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./d-panel";

describe("variant D panel", () => {
  test("compose -> rail card; doc keeps highlight only; d cuts one-keystroke; e edits in rail", async () => {
    const setup = await testRender(<App onExit={() => {}} rows={36} />, { width: 130, height: 36 });
    const until = async (needle: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
        await Bun.sleep(20);
        await setup.renderOnce();
      }
      expect(setup.captureCharFrame()).toContain(needle);
    };
    await until("D · PANEL");
    await until("no annotations yet");

    setup.mockInput.pressKey("c");
    await until("draft note - L4");
    await until("Save ⏎");
    setup.mockInput.typeText("tighten wording");
    await until("tighten wording");
    setup.mockInput.pressKey("RETURN");
    await until("ANNOTATIONS (1)");
    await until("Comment");
    expect(setup.captureCharFrame()).not.toContain("draft note");

    setup.mockInput.pressKey("j");
    await Bun.sleep(30);
    await setup.renderOnce();
    setup.mockInput.pressKey("d");
    await until("ANNOTATIONS (2)");
    await until("Deletion");
    await until("Remove this.");

    setup.mockInput.pressKey("TAB");
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(30);
      await setup.renderOnce();
    }
    setup.mockInput.pressKey("k");
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(30);
      await setup.renderOnce();
    }
    setup.mockInput.pressKey("e");
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(30);
      await setup.renderOnce();
    }
    setup.mockInput.typeText(" and shorten");
    await until("and shorten");
    setup.mockInput.pressKey("RETURN");
    await until("ANNOTATIONS (2)");
  }, 30_000);
});
