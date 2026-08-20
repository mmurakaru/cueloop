/** Diff-review flow in the virtual terminal (slice 3). */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { isolateUserConfig, press, waitForText } from "./test-support";

const PATCH = `diff --git a/src/store.ts b/src/store.ts
index 111..222 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,4 +1,4 @@
 export class Store {
-  private items = [];
+  private items = new Map();
 }
`;

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: ReviewSession;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-diff-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "diff", content: PATCH, meta: { title: "working tree" } },
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
  await waitForText(setup, "cueloop");
  return setup;
}

describe("diff review", () => {
  test("renders file header, hunks, and signed lines", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    const frame = setup.captureCharFrame();
    expect(frame).toContain("■ src/store.ts");
    expect(frame).toContain("@@ -1,4 +1,4 @@");
    expect(frame).toContain("-  private items = [];");
    expect(frame).toContain("+  private items = new Map();");
  });

  test("line comment: quote-anchored, lands in feedback with the code line", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    // rows: file(0), hunk(1), ctx(2), del(3), add(4)
    for (let i = 0; i < 4; i++) await press(setup, "j");
    await press(setup, "c");

    // Assert
    await waitForText(setup, 'comment on "');

    // Act
    await setup.mockInput.typeText("Map needs an eviction story.");
    await press(setup, "enter");

    // Assert
    // inline annotation card rendered under the line
    await waitForText(setup, "◆ Map needs an eviction story.");
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.anchor.quote).toContain("new Map()");

    // Act
    await press(setup, "enter"); // submit
    await press(setup, "enter"); // confirm request_changes

    // Assert
    await waitForText(setup, "feedback sent");
    const resolved = server.core.sessionGet(session.id);
    expect(resolved.verdict!.feedback).toContain("new Map()");
    expect(resolved.verdict!.feedback).toContain("Map needs an eviction story.");
  });

  test("curation needs full file contents; a legacy diff answers", async () => {
    // Arrange - the session carries no artifact.files
    const setup = await renderApp();

    // Act
    await press(setup, "x");

    // Assert
    await waitForText(setup, "hunk curation needs full file contents");
  });

  test("rejecting the only change empties the curated working copy", async () => {
    // Arrange - a diff session that carries full file contents
    const withFiles = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: { title: "working tree" },
        files: [
          {
            path: "src/store.ts",
            oldContents: "export class Store {\n  private items = [];\n}\n",
            newContents: "export class Store {\n  private items = new Map();\n}\n",
            status: "modified",
          },
        ],
      },
    });
    const setup = await testRender(<App home={home} sessionId={withFiles.id} />, {
      width: 120,
      height: 30,
    });
    await waitForText(setup, "cueloop");

    // Act - move to the added line and reject its change
    // rows: file(0), hunk(1), ctx(2), del(3), add(4)
    for (let i = 0; i < 4; i++) await press(setup, "j");
    await press(setup, "x");

    // Assert - the single change is gone, so the curated working copy is empty
    await waitForText(setup, "change rejected");
    const stored = server.core.sessionGet(withFiles.id);
    expect(stored.workingCopy).toBe("");
  });

  test("a rejected change lists in the rail and undo (u) restores it", async () => {
    // Arrange - a diff session that carries full file contents
    const withFiles = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: { title: "working tree" },
        files: [
          {
            path: "src/store.ts",
            oldContents: "export class Store {\n  private items = [];\n}\n",
            newContents: "export class Store {\n  private items = new Map();\n}\n",
            status: "modified",
          },
        ],
      },
    });
    const setup = await testRender(<App home={home} sessionId={withFiles.id} />, {
      width: 120,
      height: 30,
    });
    await waitForText(setup, "cueloop");

    // Act - reject the change under the added line
    // rows: file(0), hunk(1), ctx(2), del(3), add(4)
    for (let i = 0; i < 4; i++) await press(setup, "j");
    await press(setup, "x");

    // Assert - the rail shows a removal card titled REJECT · me for the change
    await waitForText(setup, "REJECT · me");
    expect(server.core.sessionGet(withFiles.id).workingCopy).toBe("");

    // Act - undo restores it (no selection, so the last item)
    await press(setup, "u");

    // Assert - the change returns to the curated diff (working copy cleared)
    await waitForText(setup, "removal restored");
    expect(server.core.sessionGet(withFiles.id).workingCopy).toBeUndefined();
  });

  test("a selected removal card shows an undo button that restores it on click", async () => {
    // Arrange - a diff session that carries full file contents
    const withFiles = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: { title: "working tree" },
        files: [
          {
            path: "src/store.ts",
            oldContents: "export class Store {\n  private items = [];\n}\n",
            newContents: "export class Store {\n  private items = new Map();\n}\n",
            status: "modified",
          },
        ],
      },
    });
    const setup = await testRender(<App home={home} sessionId={withFiles.id} />, {
      width: 120,
      height: 30,
    });
    await waitForText(setup, "cueloop");

    // Act - reject the change; the removal card lands unselected (no undo button)
    for (let i = 0; i < 4; i++) await press(setup, "j");
    await press(setup, "x");
    await waitForText(setup, "REJECT · me");
    expect(setup.captureCharFrame()).not.toContain("undo");

    // Act - click the card to select it; the undo button appears
    const clickText = async (needle: string): Promise<void> => {
      const lines = setup.captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes(needle));
      await setup.mockMouse.click(lines[row]!.indexOf(needle) + 1, row);
    };
    await clickText("REJECT · me");
    await waitForText(setup, "undo");

    // Act - click the undo button
    await clickText("undo");

    // Assert - the change returns to the curated diff (working copy cleared)
    await waitForText(setup, "removal restored");
    expect(server.core.sessionGet(withFiles.id).workingCopy).toBeUndefined();
  });
});
