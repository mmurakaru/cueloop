/** The ready signal fires once, after a frame, and writes the ready file when the env names one. */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, useEffect, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { useRenderer } from "@opentui/react";
import { READY_FILE_ENV, useReadySignal } from "./ready-signal";
import { allowEventLoopUpdates, settle } from "../testing/test-support";

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
  test("fires once after the usable frame settles", async () => {
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

type TestReadySchedulerState = ReturnType<ReturnType<typeof useRenderer>["getSchedulerState"]>;

function TestReadyAfterPresentation(props: { onReady: (state: TestReadySchedulerState) => void }) {
  const renderer = useRenderer();

  useReadySignal(true, () => props.onReady(renderer.getSchedulerState()));

  return createElement("text", null, "A usable screen");
}

test("readiness waits until the frame has finished rendering and queued output has settled", async () => {
  const observed: TestReadySchedulerState[] = [];
  const setup = await testRender(
    createElement(TestReadyAfterPresentation, {
      onReady: (state) => observed.push(state),
    }),
    { width: 30, height: 3 },
  );

  try {
    await settle(setup);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.isRendering).toBe(false);
    expect(observed[0]?.hasScheduledRender).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

function TestLiveReadiness(props: { onReady: (state: TestReadySchedulerState) => void }) {
  const renderer = useRenderer();

  useEffect(() => {
    renderer.requestLive();

    return () => renderer.dropLive();
  }, [renderer]);
  useReadySignal(true, () => {
    props.onReady(renderer.getSchedulerState());
    renderer.dropLive();
  });

  return createElement("text", null, "A live usable screen");
}

test("a continuously rendered screen announces readiness after its presented frame", async () => {
  const observed = Promise.withResolvers<TestReadySchedulerState>();
  const setup = await testRender(createElement(TestLiveReadiness, { onReady: observed.resolve }), {
    width: 30,
    height: 3,
  });

  allowEventLoopUpdates();
  const timer = setTimeout(
    () => observed.reject(new Error("Live screen did not announce readiness")),
    1000,
  );

  try {
    const state = await observed.promise;

    expect(state.isRunning).toBe(true);
    expect(state.isRendering).toBe(false);
  } finally {
    clearTimeout(timer);
    setup.renderer.destroy();
  }
});
