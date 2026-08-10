/**
 * Locks the single frame border rule: every bordered frame reads this token,
 * so a regression to square corners (or any other style) fails here first,
 * before the slower VRT snapshots catch it. Decision: rounded (issue #116).
 */

import { expect, test } from "bun:test";
import { FRAME_BORDER_STYLE } from "./frame";

test("frames use the rounded border style", () => {
  expect(FRAME_BORDER_STYLE).toBe("rounded");
});
