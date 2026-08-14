/** Post-submit completion overlay: prompt, opt-in persistence, countdown, dismissal. Countdown seconds tick on an injected ManualClock, so tests advance time instead of waiting it out. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ManualClock } from "@opentui/core/testing";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { press, settle, waitForText } from "./test-support";

const PLAN = "# Plan\n\nShip the thing.\n";

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let configPath: string;
let clock: ManualClock;

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
  clock = new ManualClock();
});
afterEach(() => {
  delete process.env.CUELOOP_CONFIG;
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp(onExit?: (code: number) => void) {
  const setup = await testRender(<App home={home} sessionId={session.id} onExit={onExit} clock={clock} />, {
    width: 120,
    height: 30,
  });
  await waitForText(setup, "cueloop");
  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

async function submitApprove(setup: Setup): Promise<void> {
  await press(setup, "enter"); // open submit (approve default: no pending items)
  await press(setup, "enter"); // confirm
  await waitForText(setup, "review approved");
}

describe("completion overlay", () => {
  test("submit with auto-close off counts down from 5; ⏎ exits now", async () => {
    // Arrange
    let exited = -1;
    const setup = await renderApp((code) => (exited = code));

    // Act
    await submitApprove(setup);

    // Assert
    const frame = await waitForText(setup, "closing in 5s");
    expect(frame).toContain("review approved");
    expect(frame).toContain("close [return]");
    expect(frame).toContain("return to plan [esc]");

    // Act
    await press(setup, "enter");

    // Assert
    expect(exited).toBe(0);
  });

  test("a remembers the countdown as the persisted default", async () => {
    // Arrange
    const setup = await renderApp();
    await submitApprove(setup);
    await waitForText(setup, "closing in 5s");

    // Act
    await press(setup, "a");

    // Assert
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, "utf8")).toContain("auto_close = 5");

    // Act
    // the countdown keeps running; each second is one manual-clock tick
    clock.advance(1000);

    // Assert
    await waitForText(setup, "closing in 4s");
  });

  test("esc dismisses to the resolved read-only view", async () => {
    // Arrange
    const setup = await renderApp();
    await submitApprove(setup);
    await waitForText(setup, "closing in 5s");

    // Act
    // a bare ESC sits in the input parser's escape-sequence disambiguation
    // window before it is delivered - the frame wait absorbs it
    await press(setup, "escape");

    // Assert
    const frame = await waitForText(setup, "resolved: approve");
    expect(frame).not.toContain("closing in");
  });

  test("configured auto_close counts down and exits without interaction", async () => {
    // Arrange
    writeFileSync(configPath, "[ui]\nauto_close = 1\n");
    let exited = -1;
    const setup = await renderApp((code) => (exited = code));
    await submitApprove(setup);
    await waitForText(setup, "closing in 1s");
    expect(exited).toBe(-1);

    // Act
    clock.advance(1000);
    await settle(setup);

    // Assert
    expect(exited).toBe(0);
  });
});
