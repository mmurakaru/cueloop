/**
 * The one frame border rule for the design system. Every bordered frame -
 * cards, dialogs, and the stories gallery chrome - reads its corner style
 * from FRAME_BORDER_STYLE, so the corner decision lives in a single place and
 * can never drift between frames. Buttons stay text-first and borderless: the
 * frame they sit in carries the border, not the button.
 */

import type { BorderStyle } from "@opentui/core";

/** Corner style shared by every bordered frame in the app: square, not rounded. */
export const FRAME_BORDER_STYLE: BorderStyle = "single";

/** Every frame's border title renders lowercase, so the convention holds without each caller minding case. */
export function frameTitle(title: string | undefined): string | undefined {
  return title?.toLowerCase();
}
