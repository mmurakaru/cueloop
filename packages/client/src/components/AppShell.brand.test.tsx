/**
 * The collapsed-sidebar brand row keeps the gear, the Threads toggle, and the
 * "cueloop" mark on one line. A long thread title used to shrink the brand box
 * until "cueloop" and the toggle wrapped onto the header's underline row; the
 * title truncates instead, so the brand never shrinks.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { AppShell } from "./AppShell";
import { NERD } from "./primitives/icons";
import { settle } from "../test-support";

const LONG_TITLE = "working tree @ GRO-1981-fe-billing-promo-cookie-migration";

async function brandFrame(): Promise<string[]> {
  const setup = await testRender(
    <AppShell
      sidebarOpen={false}
      onToggleSidebar={() => {}}
      onOpenMenu={() => {}}
      threadsPanel={<text>threads</text>}
      threadTitle={LONG_TITLE}
      threadPanel={<text>review the changes on the right</text>}
      changesOpen
      projectOpen
      onToggleChanges={() => {}}
      onToggleProject={() => {}}
      onToggleRight={() => {}}
      projectMode="changes"
      projectPanel={<text>project</text>}
      changesPanel={<text>diff</text>}
    />,
    { width: 160, height: 12 },
  );

  await settle(setup);
  await settle(setup);
  const lines = setup.captureCharFrame().split("\n");

  setup.renderer.destroy();

  return lines;
}

describe("collapsed-sidebar brand row", () => {
  test("the Threads toggle stays on the cueloop row and the title tails off in an ellipsis", async () => {
    const lines = await brandFrame();
    const brandRow = lines.findIndex((line) => line.includes("cueloop"));
    const toggleRow = lines.findIndex((line) => line.includes(NERD.sidebarLeftOff));

    expect(brandRow).toBeGreaterThanOrEqual(0);
    expect(toggleRow).toBe(brandRow);
    expect(lines[brandRow]).toContain("…");
    expect(lines[brandRow]).not.toContain(LONG_TITLE);
  });
});
