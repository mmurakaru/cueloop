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
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import { loadConfig } from "./config";
import { planLayout, reviewLayout } from "./launch-layout";
import {
  dragText,
  isolateUserConfig,
  locateText,
  pressKey,
  typeText,
  waitForState,
  waitForText,
  renderReadyApp,
} from "./test-support";
import { NERD } from "./components/primitives/icons";

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
let session: Thread;

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
  const setup = await renderReadyApp(<App home={home} sessionId={session.id} />, {
    width: 160,
    height: 20,
  });

  await waitForText(setup, "store.ts");

  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

/** The header controls sit on the top content row of the compact header. */
const HEADER_ROW = 0;

/** Column of a Project-header toggle, located by its own glyph so spacing changes never break the click. */
function toggleColumn(setup: Setup, glyph: string): number {
  return setup.captureCharFrame().split("\n")[HEADER_ROW]!.lastIndexOf(glyph);
}
const diffToggleColumn = (setup: Setup): number => toggleColumn(setup, "changes");
const treeToggleColumn = (setup: Setup): number => toggleColumn(setup, "project");
const rightToggleColumn = (setup: Setup): number => toggleColumn(setup, NERD.sidebarRight);
// the collapsed rail shows the outline (off) variant, mirroring the left toggle's filled/outline states
const railToggleColumn = (setup: Setup): number => toggleColumn(setup, NERD.sidebarRightOff);

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
    await setup.mockMouse.click(treeToggleColumn(setup), HEADER_ROW);
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

    await setup.mockMouse.click(treeToggleColumn(setup), HEADER_ROW);
    await waitForText(setup, "README.md");

    const readme = locateText(setup, "README.md");
    await setup.mockMouse.click(readme.column, readme.row);
    await waitForText(setup, "Workbench Fixture");

    const frame = setup.captureCharFrame();
    // the contents tab carries the file's text with no diff markers
    expect(frame).toContain("A tiny tracked repo.");
    expect(frame.split("\n")[HEADER_ROW]!).toContain("README.md");
  });

  test("the split control offers four directions and Split Right makes two groups", async () => {
    const setup = await renderApp();

    await setup.mockMouse.click(treeToggleColumn(setup), HEADER_ROW);
    await waitForText(setup, "README.md");
    const readme = locateText(setup, "README.md");
    await setup.mockMouse.click(readme.column, readme.row);
    await waitForText(setup, "Workbench Fixture");

    // the split control appears only on a file tab
    const split = locateText(setup, "split");
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
    await waitForState(setup, () => setup.captureCharFrame().split("split").length - 1 >= 2);
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

  test("the right-sidebar toggle closes the region and its header toggle reopens it", async () => {
    const setup = await renderApp();

    await setup.mockMouse.click(rightToggleColumn(setup), HEADER_ROW);
    await waitForState(setup, () => !setup.captureCharFrame().includes("store.ts"));

    // the right region is closed: no Changes editor, no Project tree toggles, no gutter
    expect(setup.captureCharFrame()).not.toContain("store.ts");
    expect(diffToggleColumn(setup)).toBe(-1);

    // the reopen toggle (outline/off variant) rides the thread header; clicking it reopens the region
    await setup.mockMouse.click(railToggleColumn(setup), HEADER_ROW);
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

    const zoom = locateText(setup, NERD.zoom);
    await setup.mockMouse.click(zoom.column, zoom.row);
    await waitForState(setup, () => !setup.captureCharFrame().includes("Select a thread"));

    const frame = setup.captureCharFrame();
    // the Thread pane's prompt is gone...
    expect(frame).not.toContain("Select a thread");
    // ...while the Changes editor and Project sidebar stay
    expect(frame).toContain("store.ts");
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);
  });

  test("a create-command session remembers its zoom toggle for the next bare launch", async () => {
    // a create-command opens the review zoomed; toggling zoom off must persist to the remembered layout
    const setup = await renderReadyApp(
      <App home={home} sessionId={session.id} layout={reviewLayout()} />,
      {
        width: 160,
        height: 20,
      },
    );
    await waitForText(setup, "store.ts");

    const zoom = locateText(setup, NERD.zoom);
    await setup.mockMouse.click(zoom.column, zoom.row);
    await waitForState(
      setup,
      () =>
        loadConfig({ userConfigPath: process.env.CUELOOP_CONFIG }).ui.layout?.zoomChanges === false,
    );
    expect(loadConfig({ userConfigPath: process.env.CUELOOP_CONFIG }).ui.layout?.zoomChanges).toBe(
      false,
    );
  });

  test("selecting a non-diff thread while zoomed exits zoom and restores the Thread pane", async () => {
    // a second, non-diff thread to navigate to; its sync has no Changes editor to fill a zoom
    server.core.sessionCreate({
      workspace: { repoRoot: repo, branch: "main" },
      artifact: {
        type: "plan",
        content: "# Zoomed Plan\n\nReview this plan.\n",
        meta: { title: "Zoomed Plan" },
      },
    });
    const setup = await renderApp();

    // open the collapsed Threads sidebar first (its toggle sits three cells left of the brand); the
    // brand rides the Thread header, which zoom then hides, so it must be reached before zooming
    const brand = locateText(setup, "cueloop");
    await setup.mockMouse.click(brand.column - 3, brand.row);
    await waitForText(setup, "Zoomed Plan");

    // zoom the diff - the Thread pane hides and the footer rides the Changes pane
    const zoom = locateText(setup, NERD.zoom);
    await setup.mockMouse.click(zoom.column, zoom.row);
    await waitForState(setup, () => !setup.captureCharFrame().includes("Select a thread"));

    // switch to the plan thread: it has no Changes editor, so a stranded zoom would blank the middle
    const planRow = locateText(setup, "Zoomed Plan");
    await setup.mockMouse.click(planRow.column, planRow.row);
    await waitForText(setup, "Review this plan.");

    const frame = setup.captureCharFrame();
    // the Thread pane is back with the plan, and the diff's Changes editor is gone - never a blank middle
    expect(frame).toContain("Review this plan.");
    expect(frame).not.toContain("store.ts");
  });

  test("toggling the right sidebar while zoomed exits zoom and restores the Thread pane", async () => {
    const setup = await renderApp();

    // zoom the Changes editor - the Thread pane hides
    const zoom = locateText(setup, NERD.zoom);
    await setup.mockMouse.click(zoom.column, zoom.row);
    await waitForState(setup, () => !setup.captureCharFrame().includes("Select a thread"));

    // toggling the right sidebar off must not strand a blank screen: zoom exits, the Thread pane returns
    await setup.mockMouse.click(rightToggleColumn(setup), HEADER_ROW);
    await waitForText(setup, "Select a thread");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Select a thread");
    // the right region is collapsed and the Changes editor is gone
    expect(frame).not.toContain("store.ts");
    expect(diffToggleColumn(setup)).toBe(-1);
  });

  test("hovering the right-sidebar icon surfaces its tooltip label at the screen root", async () => {
    const setup = await renderApp();

    // the tip is not painted until the pointer is over the control
    expect(setup.captureCharFrame()).not.toContain("Toggle Sidebar");

    await setup.mockMouse.moveTo(rightToggleColumn(setup), HEADER_ROW);
    // the label surfaces at the root, escaping the header cell that would otherwise clip it
    await waitForText(setup, "Toggle Sidebar");
  });
});

/** The bare-launch (no thread) shell is the same four panes as a thread: the Thread pane waits in its
 * empty state and a disposable Welcome tab rides in the Changes editor. The right-region toggles behave
 * like the thread shell, dismissing Welcome collapses the editor without stranding an empty screen, and
 * a closed right region moves its reopen toggle into the header rather than leaving a gutter. */
describe("the bare-launch welcome shell", () => {
  let welcomeHome: string;
  let welcomeRepo: string;
  let restoreWelcome: () => void;
  let welcomeServer: DaemonServer;

  beforeEach(() => {
    welcomeHome = mkdtempSync(join(tmpdir(), "cueloop-welcome-"));
    // a small, controlled launch repo so the welcome tree/changes resolve fast and deterministically
    welcomeRepo = makeRepo();
    writeFileSync(join(welcomeRepo, "README.md"), "# Fixture\n\nedited in the working tree\n");
    restoreWelcome = isolateUserConfig(welcomeHome);
    welcomeServer = new DaemonServer({ home: welcomeHome, idleExitMs: 0 });
    welcomeServer.start();
  });
  afterEach(() => {
    restoreWelcome();
    welcomeServer.stop();
    rmSync(welcomeHome, { recursive: true, force: true });
    rmSync(welcomeRepo, { recursive: true, force: true });
  });

  async function renderWelcome() {
    const setup = await testRender(
      <App home={welcomeHome} sessionId={undefined} cwd={welcomeRepo} />,
      { width: 180, height: 14 },
    );
    await waitForText(setup, "cueloop");

    return setup;
  }

  test("the project tree shows the launch repo's files even with no thread open", async () => {
    const setup = await renderWelcome();

    // the tree toggle loads the git repo the client launched in
    await setup.mockMouse.click(treeToggleColumn(setup), HEADER_ROW);
    await waitForText(setup, "README.md");
    expect(setup.captureCharFrame()).toContain("README.md");
  });

  test("the first comment in the bare shell creates and persists a per-repo workbench thread", async () => {
    const setup = await renderWelcome();

    // open a project file in the bare shell (no thread yet - nothing on disk)
    expect(welcomeServer.core.sessionList().length).toBe(0);
    await setup.mockMouse.click(treeToggleColumn(setup), HEADER_ROW);
    await waitForText(setup, "README.md");
    const readme = locateText(setup, "README.md");
    await setup.mockMouse.click(readme.column, readme.row);
    await waitForText(setup, "edited in the working tree");

    // comment on a line - the first note find-or-creates the workbench thread
    const line = "edited in the working tree";
    await dragText(setup, line, line, line.length);
    await typeText(setup, "workbench note");
    await pressKey(setup, "RETURN", { meta: true });

    // the daemon persisted one per-repo workbench thread carrying the note
    await waitForState(setup, () =>
      welcomeServer.core.sessionList().some((thread) => thread.artifact.meta.workbench === true),
    );
    const workbench = welcomeServer.core
      .sessionList()
      .find((thread) => thread.artifact.meta.workbench === true)!;
    expect(workbench.workspace.rootCommit).toBeTruthy();
    await waitForState(setup, () =>
      welcomeServer.core
        .sessionGet(workbench.id)
        .annotations.some((note) => note.body.includes("workbench note")),
    );
  });

  test("the changes tree lists the launch repo's working-tree changes", async () => {
    const setup = await renderWelcome();

    // changes mode is the default; the edited README shows with its status
    await waitForText(setup, "README.md");
    expect(setup.captureCharFrame()).toContain("README.md");
  });

  test("a review layout opens the Changes panel, listing the working-tree changes", async () => {
    const setup = await testRender(
      <App home={welcomeHome} sessionId={undefined} cwd={welcomeRepo} layout={reviewLayout()} />,
      { width: 180, height: 14 },
    );
    await waitForText(setup, "README.md");
    expect(setup.captureCharFrame()).toContain("README.md");
  });

  test("a plan layout opens with the right region closed, so no Changes panel shows", async () => {
    const setup = await testRender(
      <App home={welcomeHome} sessionId={undefined} cwd={welcomeRepo} layout={planLayout()} />,
      { width: 180, height: 14 },
    );
    await waitForText(setup, "cueloop");
    // rightSidebar "off": neither the Changes list nor the launch repo's files paint
    expect(setup.captureCharFrame()).not.toContain("README.md");
  });

  test("a hand-edited off+zoom layout drops the zoom so the center is not stranded blank", async () => {
    // zoom fills the middle with the Changes editor; with the region off there is none, so honoring zoom
    // would hide the Thread pane over a blank center. The Thread placeholder must still render.
    const setup = await testRender(
      <App
        home={welcomeHome}
        sessionId={undefined}
        cwd={welcomeRepo}
        layout={{ threads: true, rightSidebar: "off", zoomChanges: true }}
      />,
      { width: 180, height: 14 },
    );
    await waitForText(setup, "Select a thread");
    expect(setup.captureCharFrame()).toContain("Select a thread");
  });

  test("closing the right region on the vanilla shell remembers it for the next launch", async () => {
    const setup = await testRender(
      <App
        home={welcomeHome}
        sessionId={undefined}
        cwd={welcomeRepo}
        layout={{ threads: true, rightSidebar: "changes", zoomChanges: false }}
      />,
      { width: 180, height: 14 },
    );
    await waitForText(setup, "README.md");

    // close the Changes/Project region; the remembered layout follows it to "off"
    await setup.mockMouse.click(rightToggleColumn(setup), HEADER_ROW);
    await waitForState(
      setup,
      () =>
        loadConfig({ userConfigPath: process.env.CUELOOP_CONFIG }).ui.layout?.rightSidebar ===
        "off",
    );
    expect(loadConfig({ userConfigPath: process.env.CUELOOP_CONFIG }).ui.layout).toEqual({
      threads: true,
      rightSidebar: "off",
      zoomChanges: false,
    });
  });

  test("clicking a changed file in the bare shell opens its diff, not its contents", async () => {
    const setup = await renderWelcome();

    await waitForText(setup, "README.md");
    const readme = locateText(setup, "README.md");
    await setup.mockMouse.click(readme.column, readme.row);

    // a diff shows both the removed old line and the added new line; contents would show only the new
    await waitForText(setup, "A tiny tracked repo.");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("A tiny tracked repo.");
    expect(frame).toContain("edited in the working tree");
  });

  test("a bare launch rides a Welcome tab in the editor while the Thread pane waits empty", async () => {
    const setup = await renderWelcome();

    // the Welcome playground measures its width before it paints, so wait for its copy
    await waitForText(setup, "Getting started");
    const frame = setup.captureCharFrame();
    // the getting-started surface is an editor tab, not the thread pane
    expect(frame.split("\n")[HEADER_ROW]!).toContain("Welcome");
    expect(frame).toContain("Getting started");
    // the Thread pane shows its empty state until a thread is opened
    expect(frame).toContain("Select a thread");
  });

  test("typing in the welcome composer never reaches the inbox keys", async () => {
    // a pending thread in the sidebar so the inbox keys (delete, open) have a target to act on
    welcomeServer.core.sessionCreate({
      workspace: { repoRoot: welcomeRepo, branch: "main" },
      artifact: { type: "plan", content: "# Seeded\n", meta: { title: "Seeded Plan" } },
    });
    const setup = await testRender(
      <App home={welcomeHome} sessionId={undefined} cwd={welcomeRepo} />,
      { width: 160, height: 28 },
    );
    await waitForText(setup, "quick brown fox");

    // open the playground composer, then type letters that are also inbox keys (j, k, d), one at a
    // time as a person would - each keystroke settles a frame, the way real input arrives
    await dragText(setup, "quick brown fox", "quick brown fox", "quick brown fox".length);
    for (const character of "note: jkd") await typeText(setup, character);
    await waitForText(setup, "note: jkd");

    // the letters landed in the note, not the inbox: no delete confirmation opened
    expect(setup.captureCharFrame()).not.toContain("This removes the plan");

    // Cmd+Enter saves the note; it must not dispatch openSession and replace the playground
    await pressKey(setup, "RETURN", { meta: true });
    expect(setup.captureCharFrame()).toContain("Getting started");

    setup.renderer.destroy();
  });

  test("dismissing the Welcome tab collapses the editor without stranding an empty screen", async () => {
    const setup = await renderWelcome();

    const welcome = locateText(setup, "Welcome");
    // the close box sits just past the label
    await setup.mockMouse.click(welcome.column + 8, welcome.row);
    await waitForState(
      setup,
      () => !setup.captureCharFrame().includes("comment on agent-authored work"),
    );

    // the Threads sidebar and the Thread empty state remain - never a blank shell
    const frame = setup.captureCharFrame();
    expect(frame).toContain("cueloop");
    expect(frame).toContain("Select a thread");
  });

  test("the changed-files and tree toggles switch navigator mode without collapsing", async () => {
    const setup = await renderWelcome();

    expect(diffToggleColumn(setup)).toBeGreaterThan(0);

    // the tree toggle switches to the project view (the launch repo's tree) without collapsing
    await setup.mockMouse.click(treeToggleColumn(setup), HEADER_ROW);
    await waitForText(setup, "src");
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);

    // the changed-files toggle switches back, still open
    await setup.mockMouse.click(diffToggleColumn(setup), HEADER_ROW);
    await waitForState(setup, () => !setup.captureCharFrame().includes("src"));
    expect(diffToggleColumn(setup)).toBeGreaterThan(0);

    // the sidebar toggle closes the region
    await setup.mockMouse.click(rightToggleColumn(setup), HEADER_ROW);
    await waitForState(setup, () => diffToggleColumn(setup) === -1);
  });

  test("a closed region draws its reopen divider in the header only, not full-height", async () => {
    const setup = await renderWelcome();

    // close the right region so only the header toggle remains
    await setup.mockMouse.click(rightToggleColumn(setup), HEADER_ROW);
    await waitForState(setup, () => diffToggleColumn(setup) === -1);

    const lines = setup.captureCharFrame().split("\n");
    // the reopen toggle's divider sits at the far right; find its column on the header row
    const headerDivider = lines[HEADER_ROW]!.lastIndexOf("│");
    expect(headerDivider).toBeGreaterThan(0);
    // that column stays clear below the two-row header - no full-height column rule
    const bodyRows = lines.slice(3).filter((line) => line.length > headerDivider);
    expect(bodyRows.length).toBeGreaterThan(0);
    for (const line of bodyRows) {
      expect(line[headerDivider]).not.toBe("│");
    }
  });
});
