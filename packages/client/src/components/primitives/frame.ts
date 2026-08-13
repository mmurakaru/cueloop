/**
 * The one frame border rule for the design system. Every bordered frame -
 * cards, dialogs, and the stories gallery chrome - reads its corner style
 * from FRAME_BORDER_STYLE, so the rounded-corner decision lives in a single
 * place and can never drift between frames. Buttons stay text-first and
 * borderless: the frame they sit in carries the border, not the button.
 *
 * Decision: rounded on the frames, not on the buttons (issue #116).
 */

import type { BorderStyle } from "@opentui/core";

/** Corner style shared by every bordered frame in the app. */
export const FRAME_BORDER_STYLE: BorderStyle = "rounded";
