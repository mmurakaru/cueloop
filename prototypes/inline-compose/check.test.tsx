/** Headless smoke: each variant renders, opens a draft inline, saves a note. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App as MarkerApp } from "./a-marker";
import { App as ThreadApp } from "./b-thread";
import { App as SuggestionApp } from "./c-suggestion";

async function drive(app: React.ReactNode, header: string) {
  const setup = await testRender(app, { width: 100, height: 34 });
  const until = async (needle: string) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
      await Bun.sleep(20);
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain(needle);
  };
  await until(header);
  await until("Implementation Plan");
  return { setup, until };
}

describe("inline compose prototypes", () => {
  test("A marker: draft opens, save collapses to a gutter marker", async () => {
    const { setup, until } = await drive(<MarkerApp onExit={() => {}} />, "A · MARKER");
    setup.mockInput.pressKey("c");
    await until("DRAFT NOTE");
    setup.mockInput.typeText("tighten this");
    await until("tighten this");
    setup.mockInput.pressKey("RETURN");
    await until("●1");
    expect(setup.captureCharFrame()).not.toContain("DRAFT NOTE");
  });

  test("B thread: saved note stays expanded in the flow", async () => {
    const { setup, until } = await drive(<ThreadApp onExit={() => {}} />, "B · THREAD");
    setup.mockInput.pressKey("c");
    await until("DRAFT NOTE");
    setup.mockInput.typeText("expand on recovery");
    await until("expand on recovery");
    setup.mockInput.pressKey("RETURN");
    await until("note 1/1");
    await until("expand on recovery");
  });

  test("C suggestion: s pre-fills the line and previews -/+", async () => {
    const { setup, until } = await drive(<SuggestionApp onExit={() => {}} />, "C · SUGGESTION");
    setup.mockInput.pressKey("s");
    await until("SUGGEST REPLACEMENT");
    await until("- - one JSON document per session under the daemon state directory");
    setup.mockInput.pressKey("RETURN");
    await until("+ - one JSON document per session under the daemon state directory");
  });
});
