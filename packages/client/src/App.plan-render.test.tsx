/**
 * The read-only plan render mirrors the VS Code markdown preview: h1/h2 sit over
 * a rule, links show their label in the link color with the URL concealed,
 * inline code grays with its backticks gone, GFM tables render as an aligned grid
 * and leading YAML frontmatter as a bordered key/value table. Because rendered
 * text now differs from the source, a comment dragged over a concealed-markup
 * passage must still anchor to the source and repaint on the visible label.
 * Char-frame + styled-span assertions over the real App and an in-process daemon.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import { DARK } from "./theme";
import {
  dragText,
  isolateUserConfig,
  pressKey,
  renderReadyApp,
  settle,
  typeText as type,
  waitForState,
  waitForText,
} from "./test-support";

const PLAN = `---
title: Migration Plan
owner: platform team
---

# Migration Plan

## Rollout

Ship it behind a \`flag\` and read [OpenTUI](https://opentui) first.

| Name | Size |
| :--- | ---: |
| daemon | 12 |
| client | 7 |
`;

let home: string;
let server: DaemonServer;
let session: Thread;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-plan-render-"));
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

type Setup = Awaited<ReturnType<typeof renderPlan>>;

async function renderPlan() {
  const setup = await renderReadyApp(<App home={home} sessionId={session.id} />, {
    width: 90,
    height: 40,
  });

  await waitForText(setup, "cueloop");
  await settle(setup);

  return setup;
}

/** Hex foregrounds of every styled span containing the needle. */
function foregroundsOf(setup: Setup, needle: string): string[] {
  const foregrounds: string[] = [];

  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (span.fg === undefined || !span.text.includes(needle)) continue;
      const [red, green, blue] = span.fg.toInts();

      foregrounds.push(
        "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join(""),
      );
    }
  }

  return foregrounds;
}

/** Hex backgrounds of every styled span containing the needle. */
function backgroundsOf(setup: Setup, needle: string): string[] {
  const backgrounds: string[] = [];

  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue;
      const [red, green, blue] = span.bg.toInts();

      backgrounds.push(
        "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join(""),
      );
    }
  }

  return backgrounds;
}

const THREAD_MARK = "#463852";

describe("read-only markdown render", () => {
  test("h1 and h2 sit over a rule", async () => {
    const setup = await renderPlan();
    const rows = setup.captureCharFrame().split("\n");
    // "Migration Plan" also rides the header bar; a heading is any body row directly over a rule
    const ruleBelow = (heading: string): boolean =>
      rows.some((row, index) => row.includes(heading) && (rows[index + 1] ?? "").includes("──"));

    expect(ruleBelow("Migration Plan")).toBe(true);
    expect(ruleBelow("Rollout")).toBe(true);
  });

  test("a link shows its label in the link color with the URL concealed", async () => {
    const setup = await renderPlan();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("OpenTUI");
    expect(frame).not.toContain("https://opentui");
    expect(frame).not.toContain("[OpenTUI]");
    expect(foregroundsOf(setup, "OpenTUI")).toContain(DARK.blue);
  });

  test("inline code grays with its backticks concealed", async () => {
    const setup = await renderPlan();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("flag");
    expect(frame).not.toContain("`flag`");
    expect(foregroundsOf(setup, "flag")).toContain(DARK.textDim);
  });

  test("a table renders as an aligned grid without pipes", async () => {
    const setup = await renderPlan();
    const rows = setup.captureCharFrame().split("\n");
    const header = rows.find((row) => row.includes("Name") && row.includes("Size"))!;

    expect(header).not.toContain("|");
    // the numeric column is right-aligned, so 12 and 7 line up on their last digit
    const daemon = rows.find((row) => row.includes("daemon"))!;
    const client = rows.find((row) => row.includes("client"))!;

    expect(daemon.indexOf("12") + 1).toBe(client.indexOf("7"));
  });

  test("frontmatter renders as a bordered key/value grid", async () => {
    const setup = await renderPlan();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("┌");
    expect(frame).toContain("└");
    expect(frame).toContain("title");
    expect(frame).toContain("platform team");
  });
});

describe("anchoring over concealed markup", () => {
  test("a comment dragged over a rendered link label anchors to the source and repaints", async () => {
    const setup = await renderPlan();

    // drag the visible label "OpenTUI" (its brackets and URL are concealed)
    await dragText(setup, "OpenTUI", "OpenTUI", "OpenTUI".length);
    await type(setup, "which build?");
    await pressKey(setup, "RETURN", { meta: true });

    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    expect(server.core.sessionGet(session.id).annotations[0]!.anchor.quote).toBe("OpenTUI");
    // the saved comment keeps the visible label marked
    await waitForState(setup, () => backgroundsOf(setup, "OpenTUI").includes(THREAD_MARK));
  }, 60_000);
});
