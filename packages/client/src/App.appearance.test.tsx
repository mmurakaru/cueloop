/** The App renders in a light virtual terminal: passing appearance="light" threads the light branded theme through the provider without breaking the mount (the char frame is color-blind, so this covers propagation and wiring, not the pixel colors). */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { isolateUserConfig, settle, waitForText } from "./test-support";

const PLAN = "# Sync Plan\n\n## Steps\n\n- flush the queue\n";

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-appearance-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Sync Plan", planPath: "plan.md" } },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("appearance", () => {
  test("renders the review on a light terminal", async () => {
    // Arrange + Act
    const setup = await testRender(<App home={home} sessionId={session.id} appearance="light" />, {
      width: 120,
      height: 32,
    });

    // Assert
    await waitForText(setup, "cueloop");
    await waitForText(setup, "Sync Plan");
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("flush the queue");
  });
});
