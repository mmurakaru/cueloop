/** Post-submit completion overlay: prompt, opt-in persistence, countdown, dismissal. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";

const PLAN = "# Plan\n\nShip the thing.\n";

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let configPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-close-"));
  configPath = join(home, "config.toml");
  process.env.CUELOOP_CONFIG = configPath;
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Plan" } },
  });
});
afterEach(() => {
  delete process.env.CUELOOP_CONFIG;
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp(onExit?: (code: number) => void) {
  const setup = await testRender(<App home={home} sessionId={session.id} onExit={onExit} />, {
    width: 120,
    height: 30,
  });
  for (let i = 0; i < 40 && !setup.captureCharFrame().includes("cueloop"); i++) {
    await Bun.sleep(25);
    await setup.renderOnce();
  }
  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;
async function press(setup: Setup, k: string): Promise<void> {
  if (k === "enter") setup.mockInput.pressKey("RETURN");
  else if (k === "escape") setup.mockInput.pressKey("ESCAPE");
  else await setup.mockInput.typeText(k);
  await Bun.sleep(15);
  await setup.renderOnce();
}

async function submitApprove(setup: Setup): Promise<void> {
  await press(setup, "enter"); // open submit (approve default: no pending items)
  await press(setup, "enter"); // confirm
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !setup.captureCharFrame().includes("review approved")) {
    await Bun.sleep(25);
    await setup.renderOnce();
  }
}

describe("completion overlay", () => {
  test("submit with auto-close off shows the prompt; ⏎ exits", async () => {
    let exited = -1;
    const setup = await renderApp((code) => (exited = code));
    await submitApprove(setup);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("✓ review approved");
    expect(frame).toContain("a always close after submit");
    await press(setup, "enter");
    expect(exited).toBe(0);
  });

  test("a opts in: persists the config and starts the countdown", async () => {
    const setup = await renderApp();
    await submitApprove(setup);
    await press(setup, "a");
    expect(setup.captureCharFrame()).toContain("closing in 3s");
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, "utf8")).toContain("auto_close = 3");
  });

  test("esc dismisses to the resolved read-only view", async () => {
    const setup = await renderApp();
    await submitApprove(setup);
    await press(setup, "escape");
    // a bare ESC sits in the input parser's escape-sequence disambiguation
    // window before it is delivered - poll for the dismissal
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !setup.captureCharFrame().includes("resolved: approve")) {
      await Bun.sleep(50);
      await setup.renderOnce();
    }
    const frame = setup.captureCharFrame();
    expect(frame).toContain("resolved: approve");
    expect(frame).not.toContain("always close after submit");
  });

  test("configured auto_close counts down and exits without interaction", async () => {
    writeFileSync(configPath, "[ui]\nauto_close = 1\n");
    let exited = -1;
    const setup = await renderApp((code) => (exited = code));
    await submitApprove(setup);
    expect(setup.captureCharFrame()).toContain("closing in 1s");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && exited === -1) {
      await Bun.sleep(100);
      await setup.renderOnce();
    }
    expect(exited).toBe(0);
  }, 20_000);
});
