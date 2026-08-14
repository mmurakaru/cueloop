/** The review panel end to end: the b key cycles expanded -> compact -> hidden -> expanded on the live App, and the collapse mode persists to the user config so it survives a restart. Rendering details are locked by the ReviewPanel stories; this suite proves the App wiring and the persistence. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { loadConfig } from "./config";
import { press, waitForText } from "./test-support";

const PLAN = "# Plan\n\nShip the thing.\n";

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let configPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-panel-"));
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

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, { width: 120, height: 30 });
  await waitForText(setup, "Review");
  return setup;
}

describe("review panel", () => {
  test("b cycles expanded -> compact -> hidden -> expanded", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    expect(setup.captureCharFrame()).toContain("Submit review"); // expanded rail

    // Act
    await press(setup, "b");

    // Assert
    let frame = setup.captureCharFrame();
    expect(frame).toContain("«"); // compact strip shows the expand chevron
    expect(frame).not.toContain("Submit review");

    // Act
    await press(setup, "b");

    // Assert
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("«"); // hidden: no strip, no divider
    expect(frame).not.toContain("│");

    // Act
    await press(setup, "b");

    // Assert
    expect(setup.captureCharFrame()).toContain("Submit review"); // back to expanded
  });

  test("the collapse mode persists to the user config", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await press(setup, "b"); // -> compact

    // Assert
    expect(loadConfig({ userConfigPath: configPath }).ui.reviewState).toBe("compact");
  });

  test("] widens the rail and persists the new width", async () => {
    // Arrange
    const setup = await renderApp();
    const startWidth = loadConfig({ userConfigPath: configPath }).ui.reviewWidth;

    // Act
    await press(setup, "]");

    // Assert
    const widened = loadConfig({ userConfigPath: configPath }).ui.reviewWidth;
    expect(widened).toBeGreaterThan(startWidth);
  });

  test("submitting from a hidden panel force-opens the rail so the confirm card is reachable", async () => {
    // Arrange
    const setup = await renderApp();
    await press(setup, "b"); // -> compact
    await press(setup, "b"); // -> hidden

    // Assert
    expect(setup.captureCharFrame()).not.toContain("Submit review"); // rail is gone

    // Act
    await press(setup, "enter"); // submit while hidden must not trap in an invisible modal

    // Assert
    const frame = setup.captureCharFrame();
    expect(frame).toContain("submit review"); // the confirm card is visible again
    expect(frame).toContain("[Approve]");

    // the reveal is live-only: the saved panel preference stays as the user left it
    expect(loadConfig({ userConfigPath: configPath }).ui.reviewState).toBe("hidden");
  });
});
