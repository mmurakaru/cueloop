/** Smoke: both confirm variants open on n, cycle verdict, submit. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./confirm";

async function drive(variant: "modal" | "rail") {
  const setup = await testRender(<App variant={variant} onExit={() => {}} />, { width: 120, height: 36 });
  const until = async (needle: string) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !setup.captureCharFrame().includes(needle)) {
      await Bun.sleep(20);
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain(needle);
  };
  await until(`variant: ${variant}`);
  setup.mockInput.pressKey("n");
  await until("submit review");
  await until("8 annotations · 1 blocking");
  await until("[Changes]");
  setup.mockInput.pressKey("ARROW_LEFT");
  await until("[Approve]");
  setup.mockInput.pressKey("RETURN");
  await until("review submitted · approve");
}

describe("submit confirm variants", () => {
  test("modal: centered dialog over the plan", async () => {
    await drive("modal");
  }, 20_000);
  test("rail: confirm card inside the panel", async () => {
    await drive("rail");
  }, 20_000);
});
