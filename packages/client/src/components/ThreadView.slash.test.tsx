/** The "/" palette in the composer: it reopens for each "/word" the caret writes, so skills chain. */

import { describe, expect, test } from "bun:test";
import React from "react";
import type { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { QuickAction } from "../config";
import { settle, typeText } from "../test-support";
import { DARK } from "../theme";
import { buildDisplay, marksByDisplay } from "../view-plan";
import { fixturePlanSession } from "./story-fixtures";
import { ThreadView } from "./ThreadView";
import { mergeSlashItems, slashItemsFrom, type SlashItem } from "../slash-palette";
import { PaletteNamesContext, SlashSkillsContext } from "../skills";

const SKILLS: QuickAction[] = [
  { prompt: "typescript magician" },
  { prompt: "implement" },
  { prompt: "write discoverable code" },
];

const PLAN = "# Plan\n\nRefine the store before the rewrite lands.\n";

function colorToHex(color: RGBA): string {
  const [red, green, blue] = color.toInts();

  return "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** Render a plan composer, wiring the palette names into context exactly as the app does. */
async function mountComposerWithSkills(skills: SlashItem[] = [], width = 72) {
  const display = buildDisplay(PLAN, undefined);
  const names = new Set(mergeSlashItems(slashItemsFrom(SKILLS), skills).map((item) => item.name));
  const setup = await testRender(
    <SlashSkillsContext.Provider value={skills}>
      <PaletteNamesContext.Provider value={names}>
        <ThreadView
          session={fixturePlanSession({
            artifact: { type: "plan", content: PLAN, meta: { title: "Plan" } },
          })}
          display={display}
          marks={marksByDisplay([], display)}
          quickActions={SKILLS}
          observer={false}
          onAnnotate={() => {}}
          onReply={() => {}}
          onUpdateAnnotation={() => {}}
          onExit={() => {}}
        />
      </PaletteNamesContext.Provider>
    </SlashSkillsContext.Provider>,
    { width, height: 20 },
  );

  await settle(setup);
  await settle(setup);

  return setup;
}

const mountComposer = () => mountComposerWithSkills();

describe("skills in the palette", () => {
  test("a skill from context lists in the / palette and a pick inserts its /name", async () => {
    const setup = await mountComposerWithSkills([
      { name: "vitest-patterns", description: "patterns for vitest", body: "" },
    ]);

    await typeText(setup, "/vitest");
    expect(setup.captureCharFrame()).toContain("/vitest-patterns");

    setup.mockInput.pressKey("RETURN");
    await settle(setup);
    // the reference lands in the draft, exactly like a quick action
    expect(setup.captureCharFrame()).toContain("/vitest-patterns");
  });
});

describe("the palette reopens per token and chains skills", () => {
  test("a mid-sentence / opens the list, tab completes it, and a second / opens the list again", async () => {
    const setup = await mountComposer();

    // a trailing "/type" opens the full list under the composer, closest skill first
    await typeText(setup, "run /type");
    const firstList = setup.captureCharFrame();

    expect(firstList).toContain("/typescript-magician");

    // tab completes only that token, leaving the prose before it
    setup.mockInput.pressKey("TAB");
    await settle(setup);
    const completed = setup.captureCharFrame();

    expect(completed).toContain("run /typescript-magician");

    // a second "/" reopens the palette so another skill chains onto the draft
    await typeText(setup, "/impl");
    const secondList = setup.captureCharFrame();

    expect(secondList).toContain("/implement");

    setup.mockInput.pressKey("TAB");
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("run /typescript-magician /implement");
  });

  test("several skills picked on enter, with prose between, all persist in the draft", async () => {
    const setup = await mountComposerWithSkills([], 120);

    // pick the first skill, keep typing prose, pick the next, and so on
    await typeText(setup, "start /type");
    setup.mockInput.pressKey("RETURN");
    await settle(setup);

    await typeText(setup, "then run /impl");
    setup.mockInput.pressKey("RETURN");
    await settle(setup);

    await typeText(setup, "and finally /write");
    setup.mockInput.pressKey("RETURN");
    await settle(setup);

    // every pick landed as its full "/name", and the prose between them survived
    expect(setup.captureCharFrame()).toContain(
      "start /typescript-magician then run /implement and finally /write-discoverable-code",
    );
  });

  test("a completed reference paints in the accent color", async () => {
    const setup = await mountComposer();

    await typeText(setup, "please /type");
    setup.mockInput.pressKey("RETURN");
    await settle(setup);

    const accentText = setup
      .captureSpans()
      .lines.flatMap((line) => line.spans.filter((span) => colorToHex(span.fg) === DARK.accent))
      .map((span) => span.text)
      .join("");

    expect(accentText).toContain("/typescript-magician");
    // the prose around the reference is not accented
    expect(accentText).not.toContain("please");
  });
});
