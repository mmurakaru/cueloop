/**
 * Locks the single frame border rule: every bordered frame reads this token, so
 * a drift back to rounded (or any other style) fails here first, before the
 * slower VRT snapshots catch it.
 */

import { expect, test } from "bun:test";
import { FRAME_BORDER_STYLE } from "./frame";

test("frames use the square border style", () => {
  expect(FRAME_BORDER_STYLE).toBe("single");
});
