/** The share shortcut opens the two-column share dialog reachable from any view. */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import type { ShareTransport } from "./thread-controller";
import {
  isolateUserConfig,
  press,
  pressKey,
  settle,
  waitForText,
  waitForTextGone,
} from "./test-support";

const shareTransport: ShareTransport = {
  publish: mock(async () => ({ line: "ssh p_share01@cueloop.dev", copied: true })),
  pull: mock(async () => {
    throw new Error("Unexpected share pull");
  }),
  push: mock(async () => {}),
  watch: () => () => {},
  revoke: async () => {},
  parseShareId: (line) => line.match(/^ssh (\S+)@/)?.[1],
  formatShareLine: (id: string) => "ssh " + id + "@cueloop.dev",
  collaboratorAnnotations: () => [],
  mergeFromShare: () => ({ annotations: [] }),
};

const PLAN = `# Migration Plan\n\n## Context\n\nThe daemon persists sessions to disk atomically.\n`;

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: Thread;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-share-choice-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "plan",
      content: PLAN,
      meta: { title: "Migration Plan", planPath: "plan.md" },
    },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("share dialog", () => {
  test("the shortcut opens the two-column share dialog", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act
    await pressKey(setup, "s", { ctrl: true });

    // Assert - the nav categories and the empty-state new-link affordance
    await waitForText(setup, "share externally");
    await waitForText(setup, "export");
    await waitForText(setup, "+ new link");
  });

  test("new link opens the wizard, and require auth reveals the allowlist", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act: open the dialog, step into the body, activate "+ new link"
    await pressKey(setup, "s", { ctrl: true });
    await waitForText(setup, "+ new link");
    await press(setup, "enter");
    await press(setup, "enter");

    // Assert - the wizard's fields
    await waitForText(setup, "link name");
    await waitForText(setup, "require auth");

    // Act: focus the auth row and switch it on (enter toggles the focused row)
    await press(setup, "down");
    await press(setup, "enter");

    // Assert - the handles input appears with its grayed placeholder
    await waitForText(setup, "handle");

    // Act: backspace on the empty allowlist collapses require auth back off
    await press(setup, "backspace");

    // Assert - the handles section is gone
    await waitForTextGone(setup, "handle");
  });

  test("a private link with no handles cannot be created", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act: open the wizard, turn auth on but add no handles, then try to create
    await pressKey(setup, "s", { ctrl: true });
    await waitForText(setup, "+ new link");
    await press(setup, "enter"); // into the body
    await press(setup, "enter"); // open the wizard
    await waitForText(setup, "require auth");
    await press(setup, "down"); // focus the auth row
    await press(setup, "enter"); // toggle auth on (focus moves to the empty allowlist)
    await press(setup, "down"); // move to the create action
    await press(setup, "enter"); // create is blocked while the allowlist is empty
    await settle(setup);

    // Assert - the wizard is still open (nothing was created and the dialog did not fall back to the list)
    expect(setup.captureCharFrame()).toContain("require auth");
  });

  test("escape closes the dialog", async () => {
    // Arrange
    const setup = await testRender(
      <App home={home} sessionId={session.id} shareTransport={shareTransport} />,
      { width: 120, height: 32 },
    );
    await waitForText(setup, "cueloop");

    // Act
    await pressKey(setup, "s", { ctrl: true });
    await waitForText(setup, "share externally");
    await press(setup, "escape");

    // Assert
    await waitForTextGone(setup, "share externally");
  });
});
