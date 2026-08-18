/** The guided walk in the virtual terminal: the wizard steps every changed file with a plain progress title, ] marks viewed and persists with the session, esc keeps progress, w resumes at the first unviewed file (across App instances via the daemon round-trip), the agent-note block renders only for files carrying a note, and the end card hands over to the submit confirm with the honest viewed count. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { DARK } from "./theme";
import { isolateUserConfig, press, waitForState, waitForText, waitForTextGone } from "./test-support";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
 // header
-old line
+new line
diff --git a/src/c.ts b/src/c.ts
index 555..666 100644
--- a/src/c.ts
+++ b/src/c.ts
@@ -1,1 +1,2 @@
 keep
+added tail
`;

let home: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: ReviewSession;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-walk-"));
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
  const setup = await testRender(<App home={home} sessionId={session.id} />, { width: 120, height: 34 });
  // Wait for session content, not just the chrome: pressing w before the diff
  // loads drops the walk intent (no session, no diff view) and hangs the test.
  await waitForText(setup, "src/a.ts");
  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

/** Foreground colors (hex) of every styled span containing the needle. */
function foregroundsOf(setup: Setup, needle: string): string[] {
  const foregrounds: string[] = [];
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue;
      const [red, green, blue] = span.fg.toInts();
      foregrounds.push("#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join(""));
    }
  }
  return foregrounds;
}

describe("the guided walk", () => {
  test("w walks all three files: progress title, persisted marks, end card, submit hand-over", async () => {
    // Arrange
    const setup = await renderApp();

    // Act
    await press(setup, "w");

    // Assert
    await waitForText(setup, "file 1 of 3 · 0 viewed");
    expect(setup.captureCharFrame()).toContain("src/a.ts");
    expect(setup.captureCharFrame()).toContain("+1 -1");

    // Act
    await press(setup, "]");

    // Assert
    await waitForText(setup, "file 2 of 3 · 1 viewed");
    // the viewed mark rides the session record, not the client
    await waitForState(setup, () => (server.core.sessionGet(session.id).viewedPaths ?? []).includes("src/a.ts"));

    // Act
    // [ steps back; the revisited card shows its viewed marker
    await press(setup, "[");

    // Assert
    await waitForText(setup, "file 1 of 3 · 1 viewed");
    expect(setup.captureCharFrame()).toContain("· viewed");

    // Act
    await press(setup, "]");

    // Assert
    await waitForText(setup, "file 2 of 3 · 1 viewed");

    // Act
    await press(setup, "]");

    // Assert
    await waitForText(setup, "file 3 of 3 · 2 viewed");

    // Act
    await press(setup, "]");

    // Assert
    await waitForText(setup, "walk complete");
    expect(setup.captureCharFrame()).toContain("every file viewed (3/3)");
    expect(server.core.sessionGet(session.id).viewedPaths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);

    // Act
    // the end card's return leaves the walk and opens the rail confirm
    await press(setup, "enter");

    // Assert
    await waitForText(setup, "submit review");
    expect(setup.captureCharFrame()).toContain("3/3 files viewed");

    // Act
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).status === "resolved");
  });

  test("esc keeps progress and w resumes at the first unviewed file", async () => {
    // Arrange
    const setup = await renderApp();
    await press(setup, "w");
    await waitForText(setup, "file 1 of 3 · 0 viewed");
    await press(setup, "]");
    await waitForText(setup, "file 2 of 3 · 1 viewed");

    // Act
    await press(setup, "escape");

    // Assert
    await waitForTextGone(setup, "file 2 of 3");
    // the sheet is back at full strength: no wizard card on screen
    expect(setup.captureCharFrame()).not.toContain("· 1 viewed");

    // Act
    await press(setup, "w");

    // Assert
    await waitForText(setup, "file 2 of 3 · 1 viewed");
  });

  test("a half-walked review resumes across App instances via the daemon", async () => {
    // Arrange
    const first = await renderApp();
    await press(first, "w");
    await waitForText(first, "file 1 of 3 · 0 viewed");
    await press(first, "]");
    await press(first, "]");
    await waitForText(first, "file 3 of 3 · 2 viewed");
    await waitForState(first, () => (server.core.sessionGet(session.id).viewedPaths ?? []).length === 2);
    first.renderer.destroy();

    // Act
    // a fresh client reads the viewed set back from the session record
    const second = await renderApp();
    await press(second, "w");

    // Assert
    await waitForText(second, "file 3 of 3 · 2 viewed");
    expect(second.captureCharFrame()).toContain("src/c.ts");
    // two full App boots with daemon round-trips need more than the default
    // budget, and the whole-suite publish lane has timed even 15s out; give the
    // double-boot chain generous headroom so runner load cannot flake it.
  }, 60_000);

  test("the agent-note block renders only for files carrying a note", async () => {
    // Arrange
    server.core.sessionAnnotate(session.id, {
      id: "note-b",
      kind: "note",
      anchor: { quote: "src/b.ts", prefix: "", suffix: "" },
      body: "Swaps the stale line for the new constant.",
    });
    const setup = await renderApp();

    // Act
    await press(setup, "w");

    // Assert
    await waitForText(setup, "file 1 of 3");
    expect(setup.captureCharFrame()).not.toContain("agent note");

    // Act
    await press(setup, "]");

    // Assert
    await waitForText(setup, "agent note");
    expect(setup.captureCharFrame()).toContain("Swaps the stale line for the new constant.");

    // Act
    // a note is agent context, not reviewer feedback: it neither counts nor
    // flips the default verdict, and never comes back in the feedback doc
    await press(setup, "escape");
    await waitForTextGone(setup, "agent note");
    await press(setup, "enter");
    await waitForText(setup, "0 annotations");
    await press(setup, "enter");

    // Assert
    await waitForState(setup, () => server.core.sessionGet(session.id).status === "resolved");
    const resolved = server.core.sessionGet(session.id);
    expect(resolved.verdict!.kind).toBe("approve");
    expect(resolved.verdict!.feedback).not.toContain("Swaps the stale line");
  });

  test("the sheet dims behind the wizard; the preview keeps the diff colors", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    // before the walk the sheet's added line wears the insertion color
    await waitForText(setup, "+new line");
    expect(foregroundsOf(setup, "+new line")).toContain(DARK.insertedForeground);

    // Act
    await press(setup, "w");

    // Assert
    await waitForText(setup, "file 1 of 3 · 0 viewed");
    // dimmed: the sheet line drops to the dim token...
    expect(foregroundsOf(setup, "+new line")).toEqual([DARK.textDim]);
    // ...while the wizard preview keeps the insertion color
    expect(foregroundsOf(setup, "+export const b = 3;")).toContain(DARK.insertedForeground);
  });

  test("walking a resolved review answers read-only", async () => {
    // Arrange
    server.core.sessionResolve(session.id, "approve", "");
    const setup = await renderApp();
    await waitForText(setup, "resolved");

    // Act
    await press(setup, "w");

    // Assert
    await waitForText(setup, "review submitted - read-only");
    expect(setup.captureCharFrame()).not.toContain("file 1 of 3");
  });
});
