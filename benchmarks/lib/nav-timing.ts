/**
 * Click-to-first-byte for navigation: the milliseconds from a navigation action to the first
 * painted frame that actually shows the target content. This is the latency a user feels when they
 * click a thread or open a changed file - distinct from a fully-settled frame, which also waits on
 * async syntax highlighting and every follow-up commit. The number carries a fixed per-frame harness
 * cost, so it is comparable between runs, not an absolute wall-clock the user would see.
 */

import type { TestRendererSetup } from "@opentui/core/testing";

const MAX_FRAMES = 240;

/** Run `act` (a raw navigation event, not settled) and return the ms until `present` first holds. */
export async function timeToFirstPaint(
  setup: TestRendererSetup,
  act: () => void | Promise<void>,
  present: (frame: string) => boolean,
): Promise<number> {
  const started = performance.now();

  await act();
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
    // eslint-disable-next-line no-await-in-loop
    await setup.renderOnce();
    if (present(setup.captureCharFrame())) return performance.now() - started;
  }

  throw new Error("nav content never painted within the frame budget");
}
