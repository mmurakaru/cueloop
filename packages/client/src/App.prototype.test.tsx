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
} from "./test-support";

const HTML = "<main><div class='card'><h2>Pro</h2><p>$24/mo</p></div></main>";

const FAKE_ELEMENT: PrototypeElement = {
  selector: "main > div.card",
  quote: "Pro $24/mo",
  // mid-page, so the popover anchors well away from the click point below
  box: { x: 440, y: 320, width: 320, height: 220 },
};

let rendered = false;
const fakeRenderer: PrototypeRenderer = {
  viewport: { width: 1280, height: 800 },
  screenshot: async () => {
    rendered = true;
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  },
  elementAt: async () => FAKE_ELEMENT,
  highlight: async () => undefined,
  scrollBy: async () => true,
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
  test("click an element, comment on it, and it lands in the rail", async () => {
    // Arrange - wait until the fake browser produced its first screenshot, so
    // the sheet is interactive before the click
    const setup = await renderApp();
    await waitForState(setup, () => rendered);
    await settle(setup);

    // Act
    await setup.mockMouse.click(6, 6);
    await waitForText(setup, "comment");
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

    // and it renders in the rail
    await settle(setup);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("tighten the padding");
    expect(frame).toContain("COMMENT");
  });
});
