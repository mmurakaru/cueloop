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
import { press, waitForText } from "./test-support";

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
let server: DaemonServer;
let session: ReviewSession;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-diff-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "diff", content: PATCH, meta: { title: "working tree" } },
  });
});
afterEach(() => {
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, { width: 120, height: 30 });
  await waitForText(setup, "cueloop");
  return setup;
}

describe("diff review", () => {
  test("renders file header, hunks, and signed lines", async () => {
    const setup = await renderApp();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("■ src/store.ts");
    expect(frame).toContain("@@ -1,4 +1,4 @@");
    expect(frame).toContain("-  private items = [];");
    expect(frame).toContain("+  private items = new Map();");
  });

  test("line comment: quote-anchored, lands in feedback with the code line", async () => {
    const setup = await renderApp();
    // rows: file(0), hunk(1), ctx(2), del(3), add(4)
    for (let i = 0; i < 4; i++) await press(setup, "j");
    await press(setup, "c");
    expect(setup.captureCharFrame()).toContain("COMMENT ON");
    await setup.mockInput.typeText("Map needs an eviction story.");
    await press(setup, "enter");
    // inline annotation card rendered under the line
    await waitForText(setup, "◆ Map needs an eviction story.");
    const stored = server.core.sessionGet(session.id);
    expect(stored.annotations.length).toBe(1);
    expect(stored.annotations[0]!.anchor.quote).toContain("new Map()");

    await press(setup, "enter"); // submit
    await press(setup, "enter"); // confirm request_changes
    await waitForText(setup, "feedback sent");
    const resolved = server.core.sessionGet(session.id);
    expect(resolved.verdict!.feedback).toContain("new Map()");
    expect(resolved.verdict!.feedback).toContain("Map needs an eviction story.");
  });

  test("plan verbs are guarded in diff sessions", async () => {
    const setup = await renderApp();
    await press(setup, "x");
    expect(setup.captureCharFrame()).toContain("plan-only verb");
  });
});
