/** Inline skill completion in the composer (#25): the trailing "/word" token and its match. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import type { QuickAction } from "../config";
import { settle, typeText } from "../test-support";
import { buildDisplay, marksByDisplay } from "../view-plan";
import { fixturePlanSession } from "./story-fixtures";
import { inlineSlashToken, resolveInlineSuggestion, ThreadView } from "./ThreadView";

const SKILLS: QuickAction[] = [
  { prompt: "typescript magician" },
  { prompt: "implement" },
  { prompt: "write discoverable code" },
];

const PLAN = "# Plan\n\nRefine the store before the rewrite lands.\n";

async function mountComposer() {
  const display = buildDisplay(PLAN, undefined);
  const setup = await testRender(
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
    />,
    { width: 72, height: 20 },
  );

  await settle(setup);
  await settle(setup);

  return setup;
}

describe("inlineSlashToken", () => {
  test("finds the trailing slash token when text precedes it", () => {
    expect(inlineSlashToken("please run /type")).toBe("/type");
  });

  test("ignores a draft that is itself a leading slash (that is the palette)", () => {
    expect(inlineSlashToken("/type")).toBeNull();
  });

  test("is newline-safe: a token at the start of a later line still resolves", () => {
    expect(inlineSlashToken("first line\n/impl")).toBe("/impl");
  });

  test("returns null when the trailing word is not a slash token", () => {
    expect(inlineSlashToken("just some prose")).toBeNull();
  });

  test("a bare slash mid-sentence is a valid, empty-query token", () => {
    expect(inlineSlashToken("run /")).toBe("/");
  });
});

describe("resolveInlineSuggestion", () => {
  test("offers the fuzzy closest skill for the trailing token", () => {
    const inline = resolveInlineSuggestion(false, "run /type", SKILLS);

    expect(inline?.token).toBe("/type");
    expect(inline?.suggestion.name).toBe("typescript-magician");
  });

  test("prefers a prefix match over a subsequence match", () => {
    const inline = resolveInlineSuggestion(false, "run /impl", SKILLS);

    expect(inline?.suggestion.name).toBe("implement");
  });

  test("stays silent while the palette owns a leading slash", () => {
    expect(resolveInlineSuggestion(true, "/type", SKILLS)).toBeNull();
  });

  test("returns null when nothing matches the token", () => {
    expect(resolveInlineSuggestion(false, "run /zzzz", SKILLS)).toBeNull();
  });
});

describe("inline completion in the composer", () => {
  test("typing an inline slash shows the tab-hint, and tab completes to the full name", async () => {
    // Arrange - open a composer and type text with a trailing slash token
    const setup = await mountComposer();

    await typeText(setup, "run /type");

    // Assert - the hint offers the closest skill, marked with the tab glyph
    const withHint = setup.captureCharFrame();

    expect(withHint).toContain("⇥");
    expect(withHint).toContain("/typescript-magician");

    // Act - tab completes the token
    setup.mockInput.pressKey("TAB");
    await settle(setup);

    // Assert - the hint is gone and the composer now carries the full skill name
    const completed = setup.captureCharFrame();

    expect(completed).not.toContain("⇥");
    expect(completed).toContain("typescript-magician");
  });
});
