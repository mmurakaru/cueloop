/** The ready signal fires once, after a frame, and writes the ready file when the env names one. */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { READY_FILE_ENV, useReadySignal } from "./ready-signal";
import { settle } from "./test-support";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  delete process.env[READY_FILE_ENV];
});

/** Hands its readiness setter to the test, so a frame can be rendered before and after the flip. */
function ReadyProbe(props: {
  initiallyReady: boolean;
  onReady: () => void;
  exposeSetter?: (setReady: (ready: boolean) => void) => void;
}) {
  const [ready, setReady] = useState(props.initiallyReady);

  props.exposeSetter?.(setReady);
  useReadySignal(ready, props.onReady);

  return createElement("text", null, ready ? "ready" : "booting");
}

describe("useReadySignal", () => {
  test("fires once on the first frame after ready turns true", async () => {
    // Arrange - not ready yet
    let fired = 0;
    let setReady: ((ready: boolean) => void) | null = null;
    const onReady = () => {
      fired += 1;
    };
    const setup = await testRender(
      createElement(ReadyProbe, {
        initiallyReady: false,
        onReady,
        exposeSetter: (setter) => {
          setReady = setter;
        },
      }),
      { width: 20, height: 3 },
    );

    await settle(setup);
    expect(fired).toBe(0);

    // Act - ready, then let the commit, the effect, and more frames than one signal needs run
    setReady!(true);
    await settle(setup);
    await settle(setup);

    // Assert - exactly one signal, and the screen shows the ready tree
    expect(fired).toBe(1);
    expect(setup.captureCharFrame()).toContain("ready");
    setup.renderer.destroy();
  });

  test("writes the ready file through the env channel", async () => {
    // Arrange
    const home = mkdtempSync(join(tmpdir(), "cueloop-ready-"));
    const readyFile = join(home, "ready");

    homes.push(home);
    process.env[READY_FILE_ENV] = readyFile;
    const setup = await testRender(
      createElement(ReadyProbe, { initiallyReady: true, onReady: () => {} }),
      { width: 20, height: 3 },
    );

    // Act
    await settle(setup);

    // Assert
    expect(existsSync(readyFile)).toBe(true);
    setup.renderer.destroy();
  });
});
