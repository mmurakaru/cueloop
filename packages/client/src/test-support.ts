/**
 * Shared driving helpers for the virtual-terminal App suites: an input settles
 * when its painted frame stops changing across consecutive event-loop turns
 * (macrotask yield, render pass, visual-idle wait per turn) - no fixed-duration
 * sleeps. Waits on daemon round-trips go through waitForFrame/waitFor with
 * generous pass budgets.
 */

import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";

/** Pass budget for waits that include daemon or subprocess round-trips. */
export const WAIT_PASSES = { maxPasses: 400 };

/**
 * The CUELOOP_CONFIG path that isolates a test from the developer's real user
 * config: a file inside the test home that does not exist unless the test
 * writes it. Subprocess harnesses set this in the child env; in-process suites
 * use `isolateUserConfig`.
 */
export function isolatedUserConfigPath(home: string, fileName = "no-config.toml"): string {
  return join(home, fileName);
}

/**
 * Isolate the user config: point CUELOOP_CONFIG into the test home so
 * loadConfig never reads the developer's real ~/.config/cueloop (a persisted
 * review_state would change what char frames render locally while CI stays
 * clean). The default file name does not exist, so loadConfig returns
 * defaults; pass a file name for suites that write and assert a config of
 * their own. Call in beforeEach; invoke the returned restore in afterEach.
 */
export function isolateUserConfig(home: string, fileName?: string): () => void {
  const priorUserConfig = process.env.CUELOOP_CONFIG;

  process.env.CUELOOP_CONFIG = isolatedUserConfigPath(home, fileName);

  return () => {
    if (priorUserConfig === undefined) delete process.env.CUELOOP_CONFIG;
    else process.env.CUELOOP_CONFIG = priorUserConfig;
  };
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** The harness drives the real event loop by design; keep React's act warning off. */
export function allowEventLoopUpdates(): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
}

/** Turns of the event loop a frame must survive unchanged before an input counts as settled. */
const SETTLE_QUIET_TURNS = 2;

/** Upper bound on settle turns, so a surface that keeps changing never stalls a test. */
const SETTLE_MAX_TURNS = 40;

/** The painted frame with its colors, so a caret cell (background only) counts as a change. */
function paintedFrame(setup: TestRendererSetup): string {
  return JSON.stringify(
    setup
      .captureSpans()
      .lines.map((line) =>
        line.spans.map((span) => [span.text, span.fg?.toInts(), span.bg?.toInts()]),
      ),
  );
}

/**
 * Wait for an input to land: React commits its state on its own scheduler, which the renderer's
 * idle check cannot see, so on a slow machine a single idle wait returns between the key and its
 * paint. Instead, run turns of the loop until the painted frame is unchanged across
 * `SETTLE_QUIET_TURNS` consecutive turns.
 */
export async function settle(setup: TestRendererSetup): Promise<void> {
  allowEventLoopUpdates();
  let previous = "";
  let quietTurns = 0;

  for (let turn = 0; turn < SETTLE_MAX_TURNS; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();
    await setup.waitForVisualIdle();
    const frame = paintedFrame(setup);

    quietTurns = frame === previous ? quietTurns + 1 : 0;
    if (quietTurns >= SETTLE_QUIET_TURNS) return;
    previous = frame;
  }
}

/** Drive one key press: letters type as text; named keys use KeyCodes ids. */
export async function press(setup: TestRendererSetup, key: string): Promise<void> {
  if (key === "enter") setup.mockInput.pressKey("RETURN");
  else if (key === "escape") setup.mockInput.pressKey("ESCAPE");
  else if (key === "backspace") setup.mockInput.pressKey("BACKSPACE");
  else if (key === "left") setup.mockInput.pressKey("ARROW_LEFT");
  else if (key === "right") setup.mockInput.pressKey("ARROW_RIGHT");
  else if (key === "up") setup.mockInput.pressKey("ARROW_UP");
  else if (key === "down") setup.mockInput.pressKey("ARROW_DOWN");
  else return typeText(setup, key);
  await settle(setup);
}

export async function typeText(setup: TestRendererSetup, text: string): Promise<void> {
  await setup.mockInput.typeText(text);
  await settle(setup);
}

/** Drive one key press with modifiers: KeyCodes names ("ARROW_RIGHT") or single letters (ctrl+o). */
export async function pressKey(
  setup: TestRendererSetup,
  key: string,
  modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean },
): Promise<void> {
  setup.mockInput.pressKey(key, modifiers);
  await settle(setup);
}

/** A 0-based cell position within a captured char frame. */
export interface FrameLocation {
  row: number;
  column: number;
}

/** Locate the first line of a text frame containing the needle; null when absent. */
export function locateTextInFrame(frame: string, needle: string): FrameLocation | null {
  for (const [row, line] of frame.split("\n").entries()) {
    const column = line.indexOf(needle);

    if (column !== -1) return { row, column };
  }

  return null;
}

/** Locate the first visual line containing the needle: 0-based row and start column. */
export function locateText(setup: TestRendererSetup, needle: string): FrameLocation {
  const frame = setup.captureCharFrame();
  const location = locateTextInFrame(frame, needle);

  if (location === null) {
    throw new Error(`locateText ${JSON.stringify(needle)} not found.\nframe:\n${frame}`);
  }

  return location;
}

/** The 0-based visual row of the needle - for relative vertical-layout assertions. */
export function frameRow(setup: TestRendererSetup, needle: string): number {
  return locateText(setup, needle).row;
}

/** Click the first on-screen occurrence of the needle, offset in characters from its start. */
export async function clickText(
  setup: TestRendererSetup,
  needle: string,
  charOffset = 0,
): Promise<void> {
  const { row, column } = locateText(setup, needle);

  await setup.mockMouse.click(column + charOffset, row);
  await settle(setup);
}

/**
 * Drag from the first occurrence of one needle to the first occurrence of
 * another, `toCharOffset` characters past the second needle's start - so a
 * character-precise selection can end inside or right after a word.
 */
export async function dragText(
  setup: TestRendererSetup,
  fromNeedle: string,
  toNeedle: string,
  toCharOffset = 0,
): Promise<void> {
  const from = locateText(setup, fromNeedle);
  const to = locateText(setup, toNeedle);

  await setup.mockMouse.drag(from.column, from.row, to.column + toCharOffset, to.row);
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
