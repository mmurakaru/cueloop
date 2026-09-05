/** Prototype review end to end: a click on the rendered page selects a DOM element, the marker actions bar opens, a typed comment saves through the controller, and the annotation shows in the rail. The headless browser is replaced with a fake so no Chrome or kitty output is needed. Char-frame assertions over the real App and a real in-process daemon. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { App } from "./App";
import {
  setPrototypeRendererFactory,
  type PrototypeElement,
  type PrototypeRenderer,
} from "./prototype-browser";
import {
  isolateUserConfig,
  press,
  settle,
  typeText,
  waitForState,
  waitForText,
  waitForTextGone,
} from "./test-support";

const HTML = "<main><div class='card'><h2>Pro</h2><p>$24/mo</p></div></main>";

const FAKE_ELEMENT: PrototypeElement = {
  selector: "main > div.card",
  quote: "Pro $24/mo",
  // mid-page, so the popover anchors well away from the click point below
  box: { x: 440, y: 320, width: 320, height: 220 },
};

let rendered = false;
let screenshotCount = 0;
let scrollDeltas: number[] = [];
const fakeRenderer: PrototypeRenderer = {
  viewport: { width: 1280, height: 800 },
  screenshot: async () => {
    rendered = true;
    screenshotCount += 1;

    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  },
  elementAt: async () => FAKE_ELEMENT,
  scrollBy: async (deltaY) => {
    scrollDeltas.push(deltaY);

    return true;
  },
  close: async () => undefined,
};

let home: string;
let server: DaemonServer;
let session: ReviewSession;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-prototype-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "prototype",
      content: HTML,
      meta: { title: "Pricing cards", prototypePath: "/repo/cards.html" },
    },
  });
  rendered = false;
  screenshotCount = 0;
  scrollDeltas = [];
  setPrototypeRendererFactory(async () => fakeRenderer);
});
afterEach(() => {
  setPrototypeRendererFactory(null);
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

async function renderApp() {
  const setup = await testRender(<App home={home} sessionId={session.id} />, {
    width: 120,
    height: 32,
  });

  await waitForText(setup, "cueloop");

  return setup;
}

type Setup = Awaited<ReturnType<typeof renderApp>>;

async function clickText(setup: Setup, needle: string): Promise<void> {
  const lines = setup.captureCharFrame().split("\n");
  const row = lines.findIndex((line) => line.includes(needle));

  await setup.mockMouse.click(lines[row]!.indexOf(needle) + 1, row);
  await setup.renderOnce();
}

describe("prototype review", () => {
  test("click an element, comment on it, and it saves to the daemon", async () => {
    // Arrange - wait until the fake browser produced its first screenshot, so
    // the sheet is interactive before the click
    const setup = await renderApp();

    await waitForState(setup, () => rendered);
    await settle(setup);
    // selecting an element must not re-screenshot the page (the popover-click
    // lag regression): the highlight is the popover, not a fresh Chromium capture
    const screenshotsAfterLoad = screenshotCount;

    // Act
    await setup.mockMouse.click(6, 6);
    await waitForText(setup, "comment");
    expect(screenshotCount).toBe(screenshotsAfterLoad);
    await clickText(setup, "comment");
    await waitForText(setup, "write a note");
    // the keymap-suppression flag must propagate before typing so keys reach the
    // textarea, not the global keymap
    await settle(setup);
    await typeText(setup, "tighten the padding");
    await press(setup, "enter");

    // Assert - the annotation is stored against the element's selector
    await waitForState(setup, () => server.core.sessionGet(session.id).annotations.length === 1);
    const stored = server.core.sessionGet(session.id).annotations[0]!;

    expect(stored.kind).toBe("comment");
    expect(stored.body).toBe("tighten the padding");
    expect(stored.anchor.selector).toBe("main > div.card");
  });

  test("escape cancels the compose, matching the plan composer", async () => {
    // Arrange
    const setup = await renderApp();

    await waitForState(setup, () => rendered);
    await settle(setup);
    await setup.mockMouse.click(6, 6);
    await waitForText(setup, "comment");
    await clickText(setup, "comment");
    await waitForText(setup, "write a note");
    await settle(setup);

    // Act
    await press(setup, "escape");

    // Assert - the composer closes and nothing was saved
    await waitForTextGone(setup, "write a note");
    expect(server.core.sessionGet(session.id).annotations).toHaveLength(0);
  });

  test("wheel over the preview scrolls the page down, then up, and clears a selection", async () => {
    // Arrange
    const setup = await renderApp();

    await waitForState(setup, () => rendered);
    await settle(setup);

    // open a selection, then scroll: the scroll drops it (it would drift once
    // the page moves under it)
    await setup.mockMouse.click(6, 6);
    await waitForText(setup, "comment");
    // scrolling moves the page, so it DOES re-screenshot (unlike a click)
    const screenshotsBeforeScroll = screenshotCount;

    await setup.mockMouse.scroll(6, 6, "down");
    await waitForState(setup, () => scrollDeltas.length === 1);
    await waitForTextGone(setup, "comment");
    await waitForState(setup, () => screenshotCount > screenshotsBeforeScroll);

    // Act - scroll back up
    await setup.mockMouse.scroll(6, 6, "up");
    await waitForState(setup, () => scrollDeltas.length === 2);

    // Assert - down was a positive delta, up was negative
    expect(scrollDeltas[0]!).toBeGreaterThan(0);
    expect(scrollDeltas[1]!).toBeLessThan(0);
  });
});
