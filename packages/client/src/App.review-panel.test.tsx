/** The review panel end to end: the b key cycles expanded -> compact -> hidden -> expanded on the live App, and the collapse mode persists to the user config so it survives a restart. Rendering details are locked by the ReviewPanel stories; this suite proves the App wiring and the persistence. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { loadConfig } from "./config";
import { isolateUserConfig, settle, waitForText, waitForTextGone, pressKey } from "./test-support";

const PLAN = "# Plan\n\nShip the thing.\n";

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let configPath: string;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-panel-"));
  configPath = join(home, "config.toml");
  restoreUserConfig = isolateUserConfig(home, "config.toml");
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Plan" } },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, {
    width: 120,
    height: 30,
  });

  await waitForText(setup, "Review");

  return setup;
}

describe("review panel", () => {
  test("ctrl+r cycles expanded -> compact -> hidden -> expanded", async () => {
    // Arrange
    const setup = await renderApp();
    // each mode has its own signature: expanded draws the tab box and the
    // submit button, compact keeps only the count strip, hidden draws nothing
    const railSignature = () => {
      const frame = setup.captureCharFrame();

      return {
        tabs: frame.includes("Review  Agent"),
        submit: frame.includes("Submit review"),
        strip: /\s0\s*\n/.test(frame) && frame.includes("<"),
      };
    };

    // Assert: expanded
    expect(railSignature()).toEqual({ tabs: true, submit: true, strip: false });

    // Act
    await pressKey(setup, "r", { ctrl: true });

    // Assert: compact drops the tabs and the button, keeps the strip
    await waitForTextGone(setup, "Submit review");
    expect(railSignature()).toEqual({ tabs: false, submit: false, strip: true });

    // Act
    await pressKey(setup, "r", { ctrl: true });
    await settle(setup);

    // Assert: hidden draws no rail at all
    expect(railSignature()).toEqual({ tabs: false, submit: false, strip: false });

    // Act
    await pressKey(setup, "r", { ctrl: true });

    // Assert
    await waitForText(setup, "Submit review"); // back to expanded
  });

  test("the collapse mode persists to the user config", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await pressKey(setup, "r", { ctrl: true }); // -> compact

    // Assert
    expect(loadConfig({ userConfigPath: configPath }).ui.reviewState).toBe("compact");
  });

  test("option+w widens the rail and persists the new width", async () => {
    // Arrange
    const setup = await renderApp();
    const startWidth = loadConfig({ userConfigPath: configPath }).ui.reviewWidth;

    // Act
    await pressKey(setup, "w", { meta: true });

    // Assert
    const widened = loadConfig({ userConfigPath: configPath }).ui.reviewWidth;

    expect(widened).toBeGreaterThan(startWidth);
  });

  test("submitting from a hidden panel force-opens the rail so the confirm card is reachable", async () => {
    // Arrange
    const setup = await renderApp();

    await pressKey(setup, "r", { ctrl: true }); // -> compact
    await pressKey(setup, "r", { ctrl: true }); // -> hidden

    // Assert
    await waitForTextGone(setup, "Submit review"); // rail is gone
    expect(setup.captureCharFrame()).not.toContain("Submit review");

    // Act
    await pressKey(setup, "RETURN", { meta: true }); // submit while hidden must not trap in an invisible modal

    // Assert
    await waitForText(setup, "submit review");
    const frame = setup.captureCharFrame();

    expect(frame).toContain("submit review"); // the confirm card is visible again
    expect(frame).toContain("[Approve]");

    // the reveal is live-only: the saved panel preference stays as the user left it
    expect(loadConfig({ userConfigPath: configPath }).ui.reviewState).toBe("hidden");
  });
});
