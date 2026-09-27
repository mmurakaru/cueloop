/** Keyboard scrolling in a changed-file tab uses caret navigation, even when the file was deleted. */

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { DaemonServer } from "@cueloop/daemon";
import { App } from "./App";
import { annotationPaletteFor } from "./annotation-palette";
import { DARK } from "./theme";
import {
  isolateUserConfig,
  locateText,
  press,
  renderReadyApp,
  settle,
  waitForText,
} from "./test-support";

function findScrollbox(node: Renderable): ScrollBoxRenderable | null {
  if (node.id === "diff-scroll" && node instanceof ScrollBoxRenderable) return node;

  for (const child of node.getChildren()) {
    const found = findScrollbox(child);

    if (found) return found;
  }

  return null;
}

function hex(color: { toInts(): [number, number, number, number] }): string {
  const [red, green, blue] = color.toInts();

  return "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
}

test("deleted file caret scrolls one row and stays at the file boundaries", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-scroll-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cueloop-scroll-repo-"));
  const restoreConfig = isolateUserConfig(home);
  const server = new DaemonServer({ home, idleExitMs: 0 });
  let setup: Awaited<ReturnType<typeof renderReadyApp>> | undefined;

  try {
    const file = join(repo, "long.md");
    const lines = Array.from({ length: 180 }, (_, index) =>
      index === 113
        ? "[nodejs/node#36005](https://github.com/nodejs/node/issues/36005)."
        : `row ${String(index).padStart(3, "0")} ${"a paragraph with wrapped text and a link [source](https://example.test/page) ".repeat((index % 3) + 1)}`,
    );
    const git = (args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args]);

    writeFileSync(file, lines.join("\n") + "\n");
    git(["init", "-q"]);
    git(["config", "user.email", "fixture@example.com"]);
    git(["config", "user.name", "Fixture"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "seed"]);
    unlinkSync(file);
    server.start();
    setup = await renderReadyApp(<App home={home} sessionId={undefined} cwd={repo} />, {
      width: 180,
      height: 48,
    });
    await waitForText(setup, "long.md");
    const treeFile = locateText(setup, "long.md");

    await setup.mockMouse.click(treeFile.column, treeFile.row);
    await waitForText(setup, "row 00");
    const box = findScrollbox(setup.renderer.root);

    if (!box) throw new Error("file diff scrollbox missing");
    for (let offset = 0; offset < 1000; offset += 20) {
      box.scrollTo({ x: 0, y: offset });
      await settle(setup);
      if (setup.captureCharFrame().includes("row 130")) break;
    }
    const target = locateText(setup, "row 130");

    await setup.mockMouse.click(target.column, target.row);
    await press(setup, "escape");

    const steps: number[] = [];
    const caretCell = annotationPaletteFor(DARK).caretCell;
    const frameTrace: Array<{ markers: number[]; caret: number }> = [];
    const captureFrame = () => {
      const lines = setup!.captureCharFrame().split("\n");
      const markers = lines.flatMap((line, row) => (line.includes("▎") ? [row] : []));
      const caret = setup!
        .captureSpans()
        .lines.findIndex((line) => line.spans.some((span) => hex(span.bg) === caretCell));

      frameTrace.push({ markers, caret });
    };

    setup.renderer.on("frame", captureFrame);

    for (let index = 0; index < 12; index++) {
      const before = box.scrollTop;
      await press(setup, "down");
      steps.push(box.scrollTop - before);
      const caretRow = setup
        .captureSpans()
        .lines.findIndex((line) => line.spans.some((span) => hex(span.bg) === caretCell));
      const markerRows = setup
        .captureCharFrame()
        .split("\n")
        .flatMap((line, row) => (line.includes("▎") ? [row] : []));

      expect(caretRow).toBeGreaterThanOrEqual(0);
      expect(markerRows).toEqual([caretRow]);
    }

    expect(Math.max(...steps)).toBeLessThanOrEqual(1);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    let anchored = false;

    for (let index = 0; index < 80; index++) {
      await press(setup, "up");
      const marker = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("▎"));

      if (marker === box.viewport.screenY) anchored = true;
      if (anchored && box.scrollTop > 0) expect(marker).toBe(box.viewport.screenY);
    }
    expect(anchored).toBe(true);
    box.scrollTo({ x: 0, y: 100000 });
    await settle(setup);
    const last = locateText(setup, "row 179");

    await setup.mockMouse.click(last.column, last.row);
    await press(setup, "escape");
    let lastMarker = -1;

    for (let index = 0; index < 12; index++) {
      const traceStart = frameTrace.length;
      const before = box.scrollTop;

      await press(setup, "down");
      const states = frameTrace.slice(traceStart);

      expect(box.scrollTop).toBe(before);
      expect(states.length).toBeGreaterThan(0);
      for (const state of states) {
        expect(state.markers).toEqual([state.caret]);
        expect(state.caret).toBeGreaterThanOrEqual(lastMarker);
        lastMarker = state.caret;
      }
    }
    box.scrollTo({ x: 0, y: 0 });
    await settle(setup);
    const first = locateText(setup, "row 000");

    await setup.mockMouse.click(first.column, first.row);
    await press(setup, "escape");
    let firstMarker = Number.POSITIVE_INFINITY;

    for (let index = 0; index < 12; index++) {
      const traceStart = frameTrace.length;
      const before = box.scrollTop;

      await press(setup, "up");
      const states = frameTrace.slice(traceStart);

      expect(box.scrollTop).toBe(before);
      expect(states.length).toBeGreaterThan(0);
      for (const state of states) {
        expect(state.markers).toEqual([state.caret]);
        expect(state.caret).toBeLessThanOrEqual(firstMarker);
        firstMarker = state.caret;
      }
    }
    setup.renderer.off("frame", captureFrame);
  } finally {
    setup?.renderer.destroy();
    server.stop();
    restoreConfig();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}, 30000);
