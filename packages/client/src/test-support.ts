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

/** One macrotask turn: hands the event loop back so the in-process daemon can
 *  read its socket and apply the write before the next poll. Tight render-pass
 *  bursts starve that read on a contended CI runner - the round-trip then never
 *  lands and the wait hangs the whole budget. */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

/** Log a still-waiting line at most this often, so only genuinely slow (i.e.
 *  flaking) waits are noisy; fast waits stay silent. */
const PROGRESS_LOG_MS = 4000;

/** The last render frame's tail, so a progress line shows what is on screen. */
function frameTail(frame: string, rows = 6): string {
  return frame.split("\n").slice(-rows).join("\n");
}

/**
 * Poll gently: one render pass, one frame check, one macrotask yield. No
 * multi-pass bursts, so the daemon (same event loop) always gets a turn to
 * process IO between checks. The deadline bounds the whole wait. Slow waits log
 * progress (poll count + frame-change count) so a CI stall shows whether the
 * render froze or the content simply never arrived.
 */
async function waitForFramePredicate(
  setup: TestRendererSetup,
  predicate: (frame: string) => boolean,
  label: string,
): Promise<string> {
  allowEventLoopUpdates();
  const start = Date.now();
  const deadline = start + WAIT_DEADLINE_MS;
  let polls = 0;
  let frameChanges = 0;
  let lastFrame = "";
  let lastLog = start;

  for (;;) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();

    polls++;
    if (frame !== lastFrame) {
      frameChanges++;
      lastFrame = frame;
    }
    if (predicate(frame)) return frame;
    const now = Date.now();

    if (now > deadline) {
      const frozen = frameChanges <= 1 ? " - render never advanced (frozen)" : "";

      throw new Error(
        `waitFor ${label} timed out after ${now - start}ms (${polls} polls, ${frameChanges} frame changes${frozen}).\nlast frame:\n${frame}`,
      );
    }
    if (now - lastLog >= PROGRESS_LOG_MS) {
      lastLog = now;
      console.error(
        `[waitFor] still waiting for ${label} - ${now - start}ms, ${polls} polls, ${frameChanges} frame changes\n${frameTail(frame)}`,
      );
    }
    await yieldEventLoop();
  }
}

/** Wait until a state predicate holds (daemon round-trips included). */
export async function waitForState(
  setup: TestRendererSetup,
  predicate: () => boolean,
  label = "state",
): Promise<void> {
  allowEventLoopUpdates();
  const start = Date.now();
  const deadline = start + WAIT_DEADLINE_MS;
  let polls = 0;
  let frameChanges = 0;
  let lastFrame = "";
  let lastLog = start;

  for (;;) {
    if (predicate()) return;
    await setup.renderOnce();
    const frame = setup.captureCharFrame();

    polls++;
    if (frame !== lastFrame) {
      frameChanges++;
      lastFrame = frame;
    }
    if (predicate()) return;
    const now = Date.now();

    if (now > deadline) {
      const frozen = frameChanges <= 1 ? " - render never advanced (frozen)" : "";

      throw new Error(
        `waitForState ${label} timed out after ${now - start}ms (${polls} polls, ${frameChanges} frame changes${frozen}).\nlast frame:\n${frame}`,
      );
    }
    if (now - lastLog >= PROGRESS_LOG_MS) {
      lastLog = now;
      console.error(
        `[waitForState] still waiting for ${label} - ${now - start}ms, ${polls} polls, ${frameChanges} frame changes`,
      );
    }
    await yieldEventLoop();
  }
}

/** Wait until the frame contains the needle (daemon round-trips included). */
export async function waitForText(setup: TestRendererSetup, needle: string): Promise<string> {
  return waitForFramePredicate(
    setup,
    (frame) => frame.includes(needle),
    `text ${JSON.stringify(needle)}`,
  );
}

/** Wait until the frame no longer contains the needle. */
export async function waitForTextGone(setup: TestRendererSetup, needle: string): Promise<string> {
  return waitForFramePredicate(
    setup,
    (frame) => !frame.includes(needle),
    `text-gone ${JSON.stringify(needle)}`,
  );
}
