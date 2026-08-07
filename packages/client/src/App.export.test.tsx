/**
 * Tier-2 wiring test for the notes-vault export: with [integrations.obsidian]
 * configured to export on resolve, submitting a review writes the note into
 * the vault and surfaces the path in the status line.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";

const PLAN = `# Migration Plan

Move the store atomically.
`;

let home: string;
let vault: string;
let server: DaemonServer;
let session: ReviewSession;
let savedConfigEnv: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-app-export-"));
  vault = join(home, "vault");
  mkdirSync(vault);
  const configPath = join(home, "config.toml");
  writeFileSync(configPath, `[integrations.obsidian]\nvault = ${JSON.stringify(vault)}\nexportOn = "resolve"\n`);
  savedConfigEnv = process.env.CUELOOP_CONFIG;
  process.env.CUELOOP_CONFIG = configPath;
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Migration Plan", planPath: "plan.md" } },
  });
});
afterEach(() => {
  if (savedConfigEnv === undefined) delete process.env.CUELOOP_CONFIG;
  else process.env.CUELOOP_CONFIG = savedConfigEnv;
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("obsidian export on resolve", () => {
  test("submitting a review writes the plan into the vault and shows the path", async () => {
    const setup = await testRender(<App home={home} sessionId={session.id} />, { width: 120, height: 32 });
    for (let i = 0; i < 40 && !setup.captureCharFrame().includes("cueloop"); i++) {
      await Bun.sleep(25);
      await setup.renderOnce();
    }
    // open the submit overlay, keep the default verdict (approve), submit
    setup.mockInput.pressKey("RETURN");
    await Bun.sleep(15);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("verdict");
    setup.mockInput.pressKey("RETURN");
    // wall-clock deadlines: the export is an async round-trip after resolve,
    // and an iteration count times out on a loaded runner
    const dir = join(vault, "cueloop");
    const fileDeadline = Date.now() + 30_000;
    while (Date.now() < fileDeadline && !existsSync(dir)) {
      await Bun.sleep(25);
      await setup.renderOnce();
    }
    // the status line lands on a later render than the file write
    const statusDeadline = Date.now() + 30_000;
    while (Date.now() < statusDeadline && !setup.captureCharFrame().includes("exported to")) {
      await Bun.sleep(25);
      await setup.renderOnce();
    }

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
