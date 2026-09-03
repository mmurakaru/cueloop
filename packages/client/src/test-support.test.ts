import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import type { KeyEvent, MouseEvent } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { useKeyboard } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { loadConfig } from "./config";
import {
  clickText,
  dragText,
  frameRow,
  isolateUserConfig,
  locateText,
  pressKey,
  waitForText,
  type FrameLocation,
} from "./test-support";

describe("isolateUserConfig", () => {
  test("loadConfig sees defaults while isolated and the env is restored after", () => {
    // Arrange
    const home = mkdtempSync(join(tmpdir(), "cueloop-isolate-"));
    const userConfigPath = join(home, "config.toml");

    writeFileSync(userConfigPath, '[ui]\nreview_state = "compact"\n');
    const priorEnv = process.env.CUELOOP_CONFIG;

    process.env.CUELOOP_CONFIG = userConfigPath;

    try {
      // Act
      const restoreUserConfig = isolateUserConfig(home);
      const isolated = loadConfig({ repoRoot: home });

      restoreUserConfig();
      const restored = loadConfig({ repoRoot: home });

      // Assert
      expect(isolated.ui.reviewState).toBe("expanded");
      expect(process.env.CUELOOP_CONFIG).toBe(userConfigPath);
      expect(restored.ui.reviewState).toBe("compact");
    } finally {
      if (priorEnv === undefined) delete process.env.CUELOOP_CONFIG;
      else process.env.CUELOOP_CONFIG = priorEnv;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("restore removes the variable when nothing was set before", () => {
    // Arrange
    const home = mkdtempSync(join(tmpdir(), "cueloop-isolate-"));
    const priorEnv = process.env.CUELOOP_CONFIG;

    delete process.env.CUELOOP_CONFIG;

    try {
      // Act
      const restoreUserConfig = isolateUserConfig(home);
      const pointedAt = process.env.CUELOOP_CONFIG ?? "";

      restoreUserConfig();

      // Assert
      expect(pointedAt).toBe(join(home, "no-config.toml"));
      expect(process.env.CUELOOP_CONFIG).toBeUndefined();
    } finally {
      if (priorEnv !== undefined) process.env.CUELOOP_CONFIG = priorEnv;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

interface RecordedKey {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

interface RecordedMouseEvent {
  type: "down" | "up";
  x: number;
  y: number;
}

interface FixtureLog {
  keys: RecordedKey[];
  mouseEvents: RecordedMouseEvent[];
  pressZoneClicks: number[];
}

/**
 * A minimal interaction surface: one keyboard recorder, a root box recording
 * down/up coordinates, and stacked text rows at known positions.
 */
function InteractionFixture(properties: { log: FixtureLog }): ReactElement {
  const { log } = properties;

  useKeyboard((key: KeyEvent) => {
    log.keys.push({ name: key.name, ctrl: key.ctrl, shift: key.shift, meta: key.meta });
  });

  return createElement(
    "box",
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      onMouseDown: (event: MouseEvent) => {
        log.mouseEvents.push({ type: "down", x: event.x, y: event.y });
      },
      onMouseUp: (event: MouseEvent) => {
        log.mouseEvents.push({ type: "up", x: event.x, y: event.y });
      },
    },
    createElement("text", { content: "header line" }),
    createElement("text", { content: "   shifted needle" }),
    createElement("text", { content: "  drag from here" }),
    createElement("text", { content: "     drop to here" }),
    createElement("text", {
      content: "press zone",
      onMouseDown: (event: MouseEvent) => {
        log.pressZoneClicks.push(event.x);
      },
    }),
  );
}

async function renderFixture(): Promise<{ setup: TestRendererSetup; log: FixtureLog }> {
  const log: FixtureLog = { keys: [], mouseEvents: [], pressZoneClicks: [] };
  const setup = await testRender(createElement(InteractionFixture, { log }), {
    width: 40,
    height: 8,
  });

  await waitForText(setup, "press zone");

  return { setup, log };
}

describe("pressKey", () => {
  test("a ctrl+letter chord reaches the keyboard handler with ctrl set", async () => {
    // Arrange
    const { setup, log } = await renderFixture();

    // Act
    await pressKey(setup, "o", { ctrl: true });

    // Assert
    expect(log.keys).toEqual([{ name: "o", ctrl: true, shift: false, meta: false }]);
  });

  test("a named key with a modifier arrives as the modified key", async () => {
    // Arrange
    const { setup, log } = await renderFixture();

    // Act
    await pressKey(setup, "ARROW_RIGHT", { shift: true });

    // Assert
    expect(log.keys).toEqual([{ name: "right", ctrl: false, shift: true, meta: false }]);
  });
});

describe("locateText", () => {
  test("returns the 0-based row and start column of the first occurrence", async () => {
    // Arrange
    const { setup } = await renderFixture();

    // Act
    const located = locateText(setup, "shifted needle");

    // Assert
    expect(located).toEqual({ row: 1, column: 3 });
  });

  test("a miss throws with the needle and the full frame in the message", async () => {
    // Arrange
    const { setup } = await renderFixture();

    // Act
    const locateMissing = (): FrameLocation => locateText(setup, "absent needle");

    // Assert
    expect(locateMissing).toThrow('"absent needle"');
    expect(locateMissing).toThrow("header line");
  });
});

describe("frameRow", () => {
  test("returns rows that reflect the vertical layout", async () => {
    // Arrange
    const { setup } = await renderFixture();

    // Act / Assert
    expect(frameRow(setup, "header line")).toBe(0);
    expect(frameRow(setup, "drop to here")).toBe(3);
    expect(frameRow(setup, "press zone")).toBe(4);
  });
});

describe("clickText", () => {
  test("lands the click on the element rendering the needle", async () => {
    // Arrange
    const { setup, log } = await renderFixture();

    // Act
    await clickText(setup, "press zone");

    // Assert
    expect(log.pressZoneClicks).toEqual([0]);
  });

  test("charOffset shifts the click within the needle", async () => {
    // Arrange
    const { setup, log } = await renderFixture();

    // Act
    await clickText(setup, "press zone", 6);

    // Assert
    expect(log.pressZoneClicks).toEqual([6]);
  });
});

describe("dragText", () => {
  test("delivers the down at the from-text and the up at the to-text", async () => {
    // Arrange
    const { setup, log } = await renderFixture();

    // Act
    await dragText(setup, "drag from here", "drop to here");

    // Assert
    expect(log.mouseEvents).toContainEqual({ type: "down", x: 2, y: 2 });
    expect(log.mouseEvents).toContainEqual({ type: "up", x: 5, y: 3 });
  });

  test("an end offset lands the up that many characters past the to-text", async () => {
    // Arrange
    const { setup, log } = await renderFixture();

    // Act
    await dragText(setup, "drag from here", "drop to here", 4);

    // Assert
    expect(log.mouseEvents).toContainEqual({ type: "up", x: 9, y: 3 });
  });
});
