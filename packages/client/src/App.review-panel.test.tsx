/**
 * The review panel end to end: the b key cycles expanded -> compact -> hidden
 * -> expanded on the live App, and the collapse mode persists to the user
 * config so it survives a restart. Rendering details are locked by the
 * ReviewPanel stories; this suite proves the App wiring and the persistence.
 */

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
    const setup = await renderApp();
    expect(setup.captureCharFrame()).toContain("Submit review"); // expanded rail

    await press(setup, "b");
    let frame = setup.captureCharFrame();
    expect(frame).toContain("«"); // compact strip shows the expand chevron
    expect(frame).not.toContain("Submit review");

    await press(setup, "b");
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("«"); // hidden: no strip, no divider
    expect(frame).not.toContain("│");

    await press(setup, "b");
    expect(setup.captureCharFrame()).toContain("Submit review"); // back to expanded
  });

  test("the collapse mode persists to the user config", async () => {
    const setup = await renderApp();
    await press(setup, "b"); // -> compact
    expect(loadConfig({ userConfigPath: configPath }).ui.reviewState).toBe("compact");
  });

  test("] widens the rail and persists the new width", async () => {
    const setup = await renderApp();
    const startWidth = loadConfig({ userConfigPath: configPath }).ui.reviewWidth;
    await press(setup, "]");
    const widened = loadConfig({ userConfigPath: configPath }).ui.reviewWidth;
    expect(widened).toBeGreaterThan(startWidth);
  });
});
