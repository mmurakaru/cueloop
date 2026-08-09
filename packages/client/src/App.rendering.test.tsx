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
    const f = await frame();
    expect(f).toContain("  const blocked = full < 0.6;");
    expect(f).toContain('  return <text>{blocked ? "blocked" : "clear"}</text>;');
  });

  test("the block carries its language tag", async () => {
    const f = await frame();
    expect(f).toContain("tsx");
  });
});

describe("block spacing", () => {
  test("a code block never glues to the list item above it", async () => {
    const lines = (await frame()).split("\n").map((l) => l.trimEnd());
    const li = lines.findIndex((l) => l.includes("wire the duck over MQTT"));
    const codeHeader = lines.findIndex((l) => l.trim().startsWith("tsx"));
    expect(li).toBeGreaterThan(-1);
    expect(codeHeader).toBeGreaterThan(li);
    expect(lines.slice(li + 1, codeHeader).some((l) => l === "")).toBe(true);
  });

  test("a heading never sits directly on the previous block", async () => {
    const lines = (await frame()).split("\n").map((l) => l.trimEnd());
    const gate = lines.findIndex((l) => l.trim() === "Gate");
    expect(gate).toBeGreaterThan(0);
    expect(lines[gate - 1]).toBe("");
  });

  test("consecutive list items stay tight", async () => {
    const listPlan = "# T\n\n- one\n- two\n";
    const s2 = server.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: listPlan, meta: {} },
    });
    const setup = await testRender(<App home={home} sessionId={s2.id} />, { width: 120, height: 30 });
    await waitForText(setup, "one");
    const lines = setup.captureCharFrame().split("\n").map((l) => l.trimEnd());
    const one = lines.findIndex((l) => l.includes("- one"));
    expect(lines[one + 1]).toContain("- two");
  });
});
