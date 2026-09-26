/** Diff-review flow in the virtual terminal: the diff sheet annotates like the thread view. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import { pullRequestReviewLayout } from "./launch-layout";
import { DARK } from "./theme";
import { NERD } from "./components/primitives/icons";
import {
  clickText,
  dragText,
  isolateUserConfig,
  navCommand,
  press,
  pressKey,
  renderReadyApp,
  typeText,
  waitForState,
  waitForText,
} from "./test-support";

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
let session: Thread;

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

async function renderApp(sessionId = session.id) {
  const setup = await renderReadyApp(<App home={home} sessionId={sessionId} />, {
    width: 120,
    height: 30,
  });

  await waitForText(setup, "new Map()");

  return setup;
}

describe("diff review", () => {
  test("a submitted JJ review uses the existing refresh action and shows its source", async () => {
    const jjReview = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "jj" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: { title: "JJ change", vcs: "jj", vcsChangeId: "abcdefghijklmnopqrstuvwxyzaaaaaa" },
      },
    });
    const setup = await renderReadyApp(<App home={home} sessionId={jjReview.id} />, {
      width: 120,
      height: 30,
    });

    await waitForText(setup, "new Map()");
    expect(setup.captureCharFrame()).toContain("vcs: jj");
    expect(setup.captureCharFrame()).toContain("refresh");
  });

  test("pull request review shows its brief beside Changes and signals a moved head", async () => {
    const pullRequest = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "detached" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: {
          title: "Fix store",
          pr: "org/repo#42",
          prBrief: "# Fix store\n\n## PR description\n\nUse a map.",
          prHeadSha: "head-1",
          prRefreshHeadSha: "head-2",
        },
      },
    });
    const setup = await renderReadyApp(
      <App home={home} sessionId={pullRequest.id} layout={pullRequestReviewLayout()} />,
      { width: 160, height: 30 },
    );

    await waitForText(setup, "Use a map.");
    await waitForText(setup, "new Map()");
    await waitForText(setup, "refresh");
    const refreshSpan = setup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("refresh"));
    const refreshColor = refreshSpan?.fg
      .toInts()
      .slice(0, 3)
      .map((part) => part.toString(16).padStart(2, "0"))
      .join("");

    expect(`#${refreshColor}`).toBe(DARK.warning);
  });

  test("a resolved pull request review does not offer refresh", async () => {
    const pullRequest = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "detached" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: {
          title: "Fix store",
          pr: "org/repo#42",
          prHeadSha: "head-1",
          prRefreshHeadSha: "head-2",
        },
      },
    });

    server.core.sessionSendMessage(pullRequest.id, "approved", "Ready to merge.");
    const setup = await renderReadyApp(
      <App home={home} sessionId={pullRequest.id} layout={pullRequestReviewLayout()} />,
      { width: 160, height: 30 },
    );

    await waitForText(setup, "new Map()");
    expect(setup.captureCharFrame()).not.toContain("refresh");
  });

  test("renders file header, hunks, and signed lines", async () => {
    // Arrange
    const setup = await renderApp();

    // Assert
    const frame = setup.captureCharFrame();

    expect(frame).toContain("src/store.ts");
    expect(frame).toContain("@@ -1,4 +1,4 @@");
    expect(frame).toMatch(/- {2,}private items = \[\];/);
    expect(frame).toMatch(/\+ {2,}private items = new Map\(\);/);
  });

  test("a drag marks the code, typing comments on it, and the comment lands in feedback", async () => {
    // Arrange
    const setup = await renderApp();

    // Act - mark "new Map()" on the added line and just start typing, as in the thread view
    await dragText(setup, "new Map()", "new Map()", "new Map()".length);
    await typeText(setup, "Map needs an eviction story.");
    await waitForText(setup, "● Map needs an eviction story.");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the discussion card hangs under the line; the anchor is the marked words
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    await waitForText(setup, "● Map needs an eviction story.");
    expect(server.core.sessionGet(session.id).annotations[0]!.anchor.quote).toBe("new Map()");

    // Act - submit with the session chord (cmd+enter, no composer open), cycle to request changes
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "[approve]");
    await press(setup, "right");
    await waitForText(setup, "[changes]");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert
    await waitForText(setup, "feedback sent");
    const resolved = server.core.sessionGet(session.id);

    expect(resolved.message!.body).toContain("new Map()");
    expect(resolved.message!.body).toContain("Map needs an eviction story.");
  });

  test("pasting an image into a diff comment drops in an [Image #n] placeholder", async () => {
    // Arrange - mark the added line and open the inline comment composer
    const setup = await renderApp();
    await dragText(setup, "new Map()", "new Map()", "new Map()".length);
    await typeText(setup, "see ");

    // Act - a burst of control bytes stands in for the binary an image paste delivers
    await setup.mockInput.pasteBracketedText("");

    // Assert - the same placeholder the summary composer shows
    await waitForText(setup, "see [Image #1]");
  });

  test("a comment reopens with its mark painted on the code", async () => {
    // Arrange - a stored comment anchored to the added line's words
    server.core.sessionAnnotate(session.id, {
      id: "a_existing",
      kind: "comment",
      anchor: { quote: "new Map()", prefix: "  private items = ", suffix: ";" },
      body: "Existing note.",
    });

    // Act
    const setup = await renderApp();

    // Assert
    await waitForText(setup, "● Existing note.");
  });

  test("option+c folds the caret's file to its band; the chevron restores its body", async () => {
    // Arrange - the caret opens on the file's first code line
    const setup = await renderApp();

    // Act
    await navCommand(setup, "c");

    // Assert - the body is gone but the band (with its counts) remains
    await waitForState(setup, () => !setup.captureCharFrame().includes("new Map()"));
    const collapsed = setup.captureCharFrame();

    expect(collapsed).toContain("src/store.ts");
    expect(collapsed).toContain("+1");

    // Act - the band's chevron unfolds it again
    await clickText(setup, NERD.chevronRight);

    // Assert
    await waitForText(setup, "new Map()");
  });

  test("curation needs full file contents; a legacy diff answers", async () => {
    // Arrange - the session carries no artifact.files
    const setup = await renderApp();

    // Act
    await navCommand(setup, "x");

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
    const setup = await renderApp(withFiles.id);

    // Act - place the caret on the added line and reject its change
    await clickText(setup, "new Map()");
    await navCommand(setup, "x");

    // Assert - the single change is gone, so the curated working copy is empty
    await waitForState(setup, () => server.core.sessionGet(withFiles.id).workingCopy === "");
    const stored = server.core.sessionGet(withFiles.id);

    expect(stored.workingCopy).toBe("");
    expect(setup.captureCharFrame()).not.toContain("change rejected");
  });

  test("a diff opens with the Changes column listing every changed file", async () => {
    // Arrange - two changed files; config.ts is not in the patch text, so it can
    // only appear here by way of the Changes column reading artifact.files
    const withFiles = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: {
        type: "diff",
        content: PATCH,
        meta: { title: "working tree" },
        files: [
          { path: "src/store.ts", oldContents: "a", newContents: "b", status: "modified" },
          { path: "src/config.ts", oldContents: "", newContents: "c", status: "added" },
        ],
      },
    });
    const setup = await renderReadyApp(<App home={home} sessionId={withFiles.id} />, {
      width: 120,
      height: 30,
    });

    await waitForText(setup, "cueloop");

    // Assert - the context default opens the column for a diff, so both files show
    await waitForText(setup, "config.ts");
    expect(setup.captureCharFrame()).toContain("store.ts");
  });
});
