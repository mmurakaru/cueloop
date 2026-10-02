/**
 * The welcome page is a real annotation surface, but ephemeral: selecting its copy and typing leaves
 * a comment that shows inline, exactly as a file does, and it lives only in the component - there is
 * no controller or daemon behind it, so nothing is persisted. The copy prompts the two first gestures.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { WelcomePlayground } from "./WelcomePlayground";
import { DARK } from "../../appearance/theme";
import { CLIENT_VERSION } from "../../app/version";
import {
  dragText,
  locateText,
  press,
  typeText,
  pressKey,
  waitForText,
} from "../../testing/test-support";

describe("WelcomePlayground", () => {
  test("the copy prompts the select-and-type and the slash gestures", async () => {
    const setup = await testRender(<WelcomePlayground quickActions={[]} theme={DARK} />, {
      width: 80,
      height: 24,
    });

    await waitForText(setup, "Getting started");
    const frame = setup.captureCharFrame();

    expect(frame).toContain("start typing to leave your first comment");
    expect(frame).toContain('type "/"');
    expect(frame).toContain(`cueloop v${CLIENT_VERSION}`);

    setup.renderer.destroy();
  });

  test("selecting the copy and typing leaves a comment inline, exactly like a file", async () => {
    const setup = await testRender(<WelcomePlayground quickActions={[]} theme={DARK} />, {
      width: 80,
      height: 24,
    });

    // Act - select the practice line, type a comment, send it
    await waitForText(setup, "quick brown fox");
    await dragText(setup, "quick brown fox", "quick brown fox", "quick brown fox".length);
    await typeText(setup, "my first note");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the note renders on the surface, no controller or daemon involved
    await waitForText(setup, "my first note");

    setup.renderer.destroy();
  });

  test("the caret marker remains visible when Up crosses an empty line", async () => {
    const setup = await testRender(<WelcomePlayground quickActions={[]} theme={DARK} />, {
      width: 100,
      height: 28,
    });

    await waitForText(setup, "Start");
    const start = locateText(setup, "Start");

    await setup.mockMouse.click(start.column, start.row);
    await press(setup, "escape");

    const markerRows = () =>
      setup
        .captureCharFrame()
        .split("\n")
        .flatMap((line, row) => (line.includes("▎") ? [row] : []));

    expect(markerRows()).toEqual([start.row]);
    await press(setup, "up");
    expect(markerRows()).toEqual([start.row - 1]);
    await press(setup, "up");
    expect(markerRows()).toEqual([start.row - 2]);

    setup.renderer.destroy();
  });
});
