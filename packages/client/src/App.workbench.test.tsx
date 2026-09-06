/** The four-pane workbench in the virtual terminal, mirroring the browser prototype's interactions:
 * a diff session lays out Threads | Thread | Changes editor | Project sidebar; the diff (±) and tree
 * toggles are mutually exclusive and switching to tree keeps the Changes editor open; a project-tree
 * file opens as a read-only contents tab; the split control offers four directions and Split Right makes
 * two editor groups; dismissing the Changes tab collapses the Changes pane but keeps the Project sidebar;
 * the right-sidebar toggle collapses the region to a thin rail and reopens it; zoom hides the Thread pane
 * while the sidebars stay. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { isolateUserConfig, locateText, waitForState, waitForText } from "./test-support";

const PATCH = `diff --git a/src/store.ts b/src/store.ts
index 111..222 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,3 +1,3 @@
 export class Store {
-  private items = [];
+  private items = new Map();
 }
`;

let home: string;
let repo: string;
let restoreUserConfig: () => void;
let server: DaemonServer;
let session: ReviewSession;

/** A throwaway git repo so the Project tree (git ls-files) and file contents resolve without a real checkout. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "cueloop-workbench-repo-"));

  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Workbench Fixture\n\nA tiny tracked repo.\n");
  writeFileSync(join(root, "src", "store.ts"), "export class Store {}\n");
  writeFileSync(join(root, "src", "util.ts"), "export const noop = () => {};\n");
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", root, ...args]);

  git(["init", "-q"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["config", "user.name", "Fixture"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed"]);

  return root;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-workbench-"));
  repo = makeRepo();
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: repo, branch: "main" },
    artifact: { type: "diff", content: PATCH, meta: { title: "working tree" } },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, {
    width: 160,
    height: 20,
  });

  await waitForText(setup, "store.ts");

  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

/** Column of the diff (±) toggle in the Project header; the tree toggle sits +2, the sidebar toggle +4. */
function diffToggleColumn(setup: Setup): number {
  return setup.captureCharFrame().split("\n")[0]!.lastIndexOf("±");
}

describe("the four-pane workbench", () => {
  test("a diff session lays out the four panes with the diff toggle active", async () => {
    const setup = await renderApp();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("cueloop");
    expect(frame).toContain("Changes");
    expect(frame).toContain("store.ts");
    // the diff (±) toggle exists in the Project header
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);
  });

  test("switching to the project tree keeps the Changes editor open", async () => {
    const setup = await renderApp();

    // the diff and tree toggles are mutually exclusive; switch to the full project tree
    await setup.mockMouse.click(diffToggleColumn(setup) + 2, 0);
    await waitForText(setup, "README.md");

    const frame = setup.captureCharFrame();
    // the full tree is showing...
    expect(frame).toContain("README.md");
    expect(frame).toContain("src");
    // ...and the Changes editor stayed open through the mode switch
    expect(frame).toContain("Changes");
  });

  test("opening a project-tree file adds a read-only contents tab", async () => {
    const setup = await renderApp();

    await setup.mockMouse.click(diffToggleColumn(setup) + 2, 0);
    await waitForText(setup, "README.md");

    const readme = locateText(setup, "README.md");
    await setup.mockMouse.click(readme.column, readme.row);
    await waitForText(setup, "Workbench Fixture");

    const frame = setup.captureCharFrame();
    // the contents tab carries the file's text with no diff markers
    expect(frame).toContain("A tiny tracked repo.");
    expect(frame.split("\n")[0]!).toContain("README.md");
  });

  test("the split control offers four directions and Split Right makes two groups", async () => {
    const setup = await renderApp();

    await setup.mockMouse.click(diffToggleColumn(setup) + 2, 0);
    await waitForText(setup, "README.md");
    const readme = locateText(setup, "README.md");
    await setup.mockMouse.click(readme.column, readme.row);
    await waitForText(setup, "Workbench Fixture");

    // the split control appears only on a file tab
    const split = locateText(setup, "◫");
    await setup.mockMouse.click(split.column, split.row);
    await waitForText(setup, "Split Right");

    const menu = setup.captureCharFrame();
    expect(menu).toContain("Split Left");
    expect(menu).toContain("Split Right");
    expect(menu).toContain("Split Up");
    expect(menu).toContain("Split Down");

    const right = locateText(setup, "Split Right");
    await setup.mockMouse.click(right.column, right.row);
    // two editor groups now ride the header, each with its own split control
    await waitForState(setup, () => (setup.captureCharFrame().match(/◫/g) ?? []).length >= 2);
    expect((setup.captureCharFrame().match(/README\.md/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("dismissing the Changes tab collapses the Changes pane but keeps the Project sidebar", async () => {
    const setup = await renderApp();

    const changes = locateText(setup, "Changes");
    // the tab's close box sits just past the label; the ✕ is a hover affordance, the box always clicks
    await setup.mockMouse.click(changes.column + 8, changes.row);
    await waitForState(setup, () => !setup.captureCharFrame().includes("store.ts"));

    const frame = setup.captureCharFrame();
    // the Changes editor is gone...
    expect(frame).not.toContain("store.ts");
    // ...but the Project sidebar and its toggles remain
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);
  });

  test("the right-sidebar toggle collapses the region to a rail and reopens it", async () => {
    const setup = await renderApp();

    const railColumn = diffToggleColumn(setup) + 4;
    await setup.mockMouse.click(railColumn, 0);
    await waitForState(setup, () => !setup.captureCharFrame().includes("store.ts"));

    // the right region is closed: no Changes editor, no Project tree toggles
    expect(setup.captureCharFrame()).not.toContain("store.ts");
    expect(diffToggleColumn(setup)).toBe(-1);

    // the thin rail's toggle reopens the region, restoring the Changes editor
    await setup.mockMouse.click(railColumn, 0);
    await waitForText(setup, "store.ts");
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);
  });

  test("the Threads toggle opens and closes the sidebar, relocating the brand", async () => {
    const setup = await renderApp();

    // deep-linked into a session, the Threads sidebar starts collapsed: the brand rides in the
    // Thread header and the inbox groups are hidden
    const collapsed = setup.captureCharFrame();
    expect(collapsed).toContain("cueloop");
    expect(collapsed).not.toContain("Threads");

    // the sidebar toggle sits just left of the brand (one glyph plus its margin)
    const brand = locateText(setup, "cueloop");
    await setup.mockMouse.click(brand.column - 3, brand.row);
    await waitForText(setup, "Threads");

    // the Threads pane is open with its inbox groups, and the brand moved into its header
    expect(setup.captureCharFrame()).toContain("Threads");

    // toggling again collapses it back
    const reopened = locateText(setup, "cueloop");
    await setup.mockMouse.click(reopened.column - 3, reopened.row);
    await waitForState(setup, () => !setup.captureCharFrame().includes("Threads"));
    expect(setup.captureCharFrame()).not.toContain("Threads");
  });

  test("zoom hides the Thread pane while the sidebars stay", async () => {
    const setup = await renderApp();

    const zoom = locateText(setup, "⛶");
    await setup.mockMouse.click(zoom.column, zoom.row);
    await waitForState(setup, () => !setup.captureCharFrame().includes("review the changes"));

    const frame = setup.captureCharFrame();
    // the Thread pane's prompt is gone...
    expect(frame).not.toContain("review the changes");
    // ...while the Changes editor and Project sidebar stay
    expect(frame).toContain("store.ts");
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);
  });
});
