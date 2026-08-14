/** Plan rendering: code blocks verbatim + contained, spacing never collapses. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import { waitForText } from "./test-support";

const PLAN = `# Render Plan

## Sensor

- wire the duck over MQTT

\`\`\`tsx
export function Gate({ full }: { full: number }) {
  const blocked = full < 0.6;
  return <text>{blocked ? "blocked" : "clear"}</text>;
}
\`\`\`

## Gate

Deploys block below the threshold.
`;

let home: string;
let server: DaemonServer;
let session: ReviewSession;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-render-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Render Plan" } },
  });
});
afterEach(() => {
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function frame(): Promise<string> {
  const setup = await testRender(<App home={home} sessionId={session.id} />, { width: 120, height: 36 });
  await waitForText(setup, "Render Plan");
  // async highlights settle within the visual-idle wait
  await setup.waitForVisualIdle();
  return setup.captureCharFrame();
}

describe("code blocks", () => {
  test("lines render verbatim: indentation preserved, no word-wrap", async () => {
    // Arrange
    const rendered = await frame();

    // Assert
    expect(rendered).toContain("  const blocked = full < 0.6;");
    expect(rendered).toContain('  return <text>{blocked ? "blocked" : "clear"}</text>;');
  });

  test("the block carries its language tag", async () => {
    // Arrange
    const rendered = await frame();

    // Assert
    expect(rendered).toContain("tsx");
  });
});

describe("block spacing", () => {
  // the review panel's full-height divider paints a `│` on every row, so read
  // the plan column (everything left of the divider) before asserting spacing
  const planColumn = (line: string): string => line.split("│")[0]!.trimEnd();

  test("a code block never glues to the list item above it", async () => {
    // Arrange
    const lines = (await frame()).split("\n").map(planColumn);
    const listItemLineIndex = lines.findIndex((line) => line.includes("wire the duck over MQTT"));
    const codeHeader = lines.findIndex((line) => line.trim().startsWith("tsx"));

    // Assert
    expect(listItemLineIndex).toBeGreaterThan(-1);
    expect(codeHeader).toBeGreaterThan(listItemLineIndex);
    expect(lines.slice(listItemLineIndex + 1, codeHeader).some((line) => line === "")).toBe(true);
  });

  test("a heading never sits directly on the previous block", async () => {
    // Arrange
    const lines = (await frame()).split("\n").map(planColumn);
    const gate = lines.findIndex((line) => line.trim() === "Gate");

    // Assert
    expect(gate).toBeGreaterThan(0);
    expect(lines[gate - 1]).toBe("");
  });

  test("consecutive list items stay tight", async () => {
    // Arrange
    const listPlan = "# T\n\n- one\n- two\n";
    const s2 = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: listPlan, meta: {} },
    });
    const setup = await testRender(<App home={home} sessionId={s2.id} />, { width: 120, height: 30 });
    await waitForText(setup, "one");

    // Assert
    const lines = setup.captureCharFrame().split("\n").map((line) => line.trimEnd());
    const one = lines.findIndex((line) => line.includes("- one"));
    expect(lines[one + 1]).toContain("- two");
  });
});
