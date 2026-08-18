/**
 * Shared driving helpers for the virtual-terminal App suites: key presses
 * settle through a macrotask yield (input parser + React scheduler), one
 * render pass, and the renderer's visual-idle wait - no fixed-duration
 * sleeps. Waits on daemon round-trips go through waitForFrame/waitFor with
 * generous pass budgets.
 */

import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";

/** Pass budget for waits that include daemon or subprocess round-trips. */
export const WAIT_PASSES = { maxPasses: 400 };

/**
 * Isolate the user config: point CUELOOP_CONFIG into the test home so
 * loadConfig never reads the developer's real ~/.config/cueloop (a persisted
 * review_state would change what char frames render locally while CI stays
 * clean). The default file name does not exist, so loadConfig returns
 * defaults; pass a file name for suites that write and assert a config of
 * their own. Call in beforeEach; invoke the returned restore in afterEach.
 */
export function isolateUserConfig(home: string, fileName = "no-config.toml"): () => void {
  const priorUserConfig = process.env.CUELOOP_CONFIG;
  process.env.CUELOOP_CONFIG = join(home, fileName);
  return () => {
    if (priorUserConfig === undefined) delete process.env.CUELOOP_CONFIG;
    else process.env.CUELOOP_CONFIG = priorUserConfig;
  };
}

/** The harness drives the real event loop by design; keep React's act warning off. */
export function allowEventLoopUpdates(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
}

/**
 * One macrotask yield lets the input parser and the React scheduler run,
 * then a render pass commits the result before the visual-idle wait.
 */
export async function settle(setup: TestRendererSetup): Promise<void> {
  allowEventLoopUpdates();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await setup.renderOnce();
  await setup.waitForVisualIdle();
}

/** Drive one key press: letters type as text; named keys use KeyCodes ids. */
export async function press(setup: TestRendererSetup, key: string): Promise<void> {
  if (key === "enter") setup.mockInput.pressKey("RETURN");
  else if (key === "escape") setup.mockInput.pressKey("ESCAPE");
  else if (key === "backspace") setup.mockInput.pressKey("BACKSPACE");
  else if (key === "left") setup.mockInput.pressKey("ARROW_LEFT");
  else if (key === "right") setup.mockInput.pressKey("ARROW_RIGHT");
  else return typeText(setup, key);
  await settle(setup);
}

export async function typeText(setup: TestRendererSetup, text: string): Promise<void> {
  await setup.mockInput.typeText(text);
  await settle(setup);
}

// Below the 60s per-test budget so a genuinely stuck wait throws its frame
// error (useful) before bun's bare "timed out" fires. Generous because a
// contended CI runner starves the render loop and daemon round-trips.
const WAIT_DEADLINE_MS = 45_000;

/**
 * waitForFrame gives up as soon as the renderer is idle, but external timers
 * (the parser's bare-ESC window, daemon IO, spawned editors) settle on the
 * event loop while nothing is scheduled. Between attempts, one real
 * event-loop turn plus a render pass lets those land; the deadline bounds
 * the whole wait.
 */
async function waitForFramePredicate(
  setup: TestRendererSetup,
  predicate: (frame: string) => boolean,
): Promise<string> {
  allowEventLoopUpdates();
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  for (;;) {
    try {
      return await setup.waitForFrame(predicate, { maxPasses: 50 });
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1));
      await setup.renderOnce();
    }
  }
}

/** Wait until a state predicate holds (daemon round-trips included). */
export async function waitForState(setup: TestRendererSetup, predicate: () => boolean): Promise<void> {
  allowEventLoopUpdates();
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  for (;;) {
    try {
      return await setup.waitFor(predicate, { maxPasses: 50 });
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1));
      await setup.renderOnce();
    }
  }
}

/** Wait until the frame contains the needle (daemon round-trips included). */
export async function waitForText(setup: TestRendererSetup, needle: string): Promise<string> {
  return waitForFramePredicate(setup, (frame) => frame.includes(needle));
}

/** Wait until the frame no longer contains the needle. */
export async function waitForTextGone(setup: TestRendererSetup, needle: string): Promise<string> {
  return waitForFramePredicate(setup, (frame) => !frame.includes(needle));
}
