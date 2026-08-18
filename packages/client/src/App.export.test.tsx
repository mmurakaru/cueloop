/** Tier-2 wiring for the notes-vault export: with [integrations.obsidian] set to export on resolve, submitting a review writes the note into the vault and surfaces the path in the status line. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { isolateUserConfig, press, waitForState, waitForText } from "./test-support";

const PLAN = `# Migration Plan

Move the store atomically.
`;

let home: string;
let vault: string;
let server: DaemonServer;
let session: ReviewSession;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-app-export-"));
  vault = join(home, "vault");
  mkdirSync(vault);
  const configPath = join(home, "config.toml");
  writeFileSync(configPath, `[integrations.obsidian]\nvault = ${JSON.stringify(vault)}\nexportOn = "resolve"\n`);
  restoreUserConfig = isolateUserConfig(home, "config.toml");
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Migration Plan", planPath: "plan.md" } },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("obsidian export on resolve", () => {
  test("submitting a review writes the plan into the vault and shows the path", async () => {
    // Arrange
    const setup = await testRender(<App home={home} sessionId={session.id} />, { width: 120, height: 32 });
    await waitForText(setup, "cueloop");

    // Act
    await press(setup, "enter"); // open the submit overlay, keep the default verdict (approve)

    // Assert
    await waitForText(setup, "[Approve]");

    // Act
    await press(setup, "enter"); // submit

    // Assert
    // the export is an async round-trip after resolve; the status line lands
    // on a later render than the file write
    const dir = join(vault, "cueloop");
    await waitForState(setup, () => existsSync(dir));
    await waitForText(setup, "exported to");

    const notes = readdirSync(dir);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/^\d{4}-\d{2}-\d{2} - Migration Plan\.md$/);
    const written = readFileSync(join(dir, notes[0]!), "utf8");
    expect(written).toContain("source: cueloop");
    expect(written).toContain(`session: ${session.id}`);
    expect(written).toContain("verdict: approve");
    expect(written).toContain("Move the store atomically.");
    expect(setup.captureCharFrame()).toContain("exported to");
  });
});
