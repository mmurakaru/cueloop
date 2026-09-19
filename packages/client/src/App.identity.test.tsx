/** Reviewer identity surfaces: the Account settings tab and the author-name tooltip on a comment dot. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import { App } from "./App";
import { isolateUserConfig, locateText, renderReadyApp, waitForText } from "./test-support";

const PLAN = "# Migration Plan\n\nThe daemon persists sessions to disk atomically.\n";

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let sessionId: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-identity-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  const session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "plan",
      content: PLAN,
      meta: { title: "Migration Plan", planPath: "plan.md" },
    },
  });
  sessionId = session.id;
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp() {
  return renderReadyApp(<App home={home} sessionId={sessionId} />, { width: 120, height: 32 });
}

test("the Account settings tab shows the display name row and the GitHub sync action", async () => {
  const setup = await renderApp();

  await setup.mockMouse.click(1, 0);
  await waitForText(setup, "settings");
  const menu = setup.captureCharFrame().split("\n");
  const settingsRow = menu.findIndex((line) => line.includes("settings"));

  await setup.mockMouse.click(menu[settingsRow]!.indexOf("settings") + 1, settingsRow);
  await waitForText(setup, "Account");
  const dialog = setup.captureCharFrame().split("\n");
  const accountRow = dialog.findIndex((line) => line.includes("Account"));

  await setup.mockMouse.click(dialog[accountRow]!.indexOf("Account") + 1, accountRow);
  await waitForText(setup, "Display name");
  expect(setup.captureCharFrame()).toContain("Sync from GitHub");
});

test("hovering an own comment's dot surfaces the author tooltip", async () => {
  server.core.sessionAnnotate(sessionId, {
    id: "a_own",
    kind: "comment",
    anchor: { quote: "atomically", prefix: "sessions to disk ", suffix: "." },
    body: "My note.",
  });
  const setup = await renderApp();

  await waitForText(setup, "● My note.");
  // the tooltip is not painted until the pointer is over the dot
  expect(setup.captureCharFrame()).not.toContain("you");
  const dot = locateText(setup, "● My note.");

  await setup.mockMouse.moveTo(dot.column, dot.row);
  await waitForText(setup, "you");
});
