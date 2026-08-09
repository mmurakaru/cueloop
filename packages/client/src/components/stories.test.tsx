/**
 * The catalog IS the regression suite (#86): every exported story renders in
 * a virtual terminal, its char frame snapshots, and its declared colors must
 * appear among the styled spans. A component file without a colocated
 * stories file fails the harness, so the safety net cannot silently thin.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { RGBA } from "@opentui/core";
import { componentFilesMissingStories, loadStories } from "./story";

const stories = await loadStories();

function hexOf(color: RGBA): string {
  const [red, green, blue] = color.toInts();
  return "#" + [red, green, blue].map((part) => part!.toString(16).padStart(2, "0")).join("");
}

describe("stories catalog", () => {
  test("every component file ships stories", () => {
    expect(componentFilesMissingStories()).toEqual([]);
  });

  test("the catalog is not empty", () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  for (const { moduleTitle, storyName, story } of stories) {
    test(`${moduleTitle}/${storyName} renders, snapshots, and carries its colors`, async () => {
      const size = story.size ?? { width: 80, height: 24 };
      const setup = await testRender(story.render(), size);
      await setup.waitForVisualIdle();
      const frame = setup.captureCharFrame();
      expect(frame).toMatchSnapshot(`${moduleTitle}/${storyName}`);
      if (story.expectedColors?.length) {
        const seenColors = new Set<string>();
        for (const line of setup.captureSpans().lines) {
          for (const span of line.spans) {
            seenColors.add(hexOf(span.fg));
            seenColors.add(hexOf(span.bg));
          }
        }
        for (const expectedColor of story.expectedColors) {
          expect(seenColors).toContain(expectedColor.toLowerCase());
        }
      }
      setup.renderer.destroy();
    });
  }
});
