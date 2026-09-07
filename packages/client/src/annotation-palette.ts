/**
 * The shared annotation palette: how a marked stretch, the caret cell, and a
 * discussion card's accent edge paint, in every surface that hosts inline
 * comments (the plan thread view and the diff sheet). One source, so a mark
 * looks the same wherever it is drawn.
 */

import { createTextAttributes } from "@opentui/core";
import type { Theme } from "./theme";

export const UNDERLINE = createTextAttributes({ underline: true });
export const CUT = createTextAttributes({ strikethrough: true, dim: true });
export const BOLD = createTextAttributes({ bold: true });

/** The marked-words treatment: a violet backdrop under an underline. */
const MARK_BACKDROP_DARK = "#463852";
const MARK_BACKDROP_LIGHT = "#e6ddf5";
/** The discussion card's accent left edge. */
const CARD_EDGE_DARK = "#ab7aca";
const CARD_EDGE_LIGHT = "#8b5fd6";
/** The caret cell: a visible cursor painted on the character under the caret. */
const CARET_CELL_DARK = "#565b68";
const CARET_CELL_LIGHT = "#b8bcc8";

export interface AnnotationPalette {
  markBackdrop: string;
  cardEdge: string;
  caretCell: string;
}

/** Dark tokens carry light text; use that to pick the palette variant. */
export function annotationPaletteFor(tokens: Theme): AnnotationPalette {
  const dark = Number.parseInt(tokens.text.slice(1, 3) || "e4", 16) > 128;

  return dark
    ? { markBackdrop: MARK_BACKDROP_DARK, cardEdge: CARD_EDGE_DARK, caretCell: CARET_CELL_DARK }
    : {
        markBackdrop: MARK_BACKDROP_LIGHT,
        cardEdge: CARD_EDGE_LIGHT,
        caretCell: CARET_CELL_LIGHT,
      };
}

/** Focus cue: mix a hex color toward white, keeping its hue readable. */
export function lighten(hex: string, amount = 0.25): string {
  const channels = hex.match(/^#(..)(..)(..)$/);

  if (!channels) return hex;
  const lifted = channels
    .slice(1)
    .map((channel) => {
      const value = Number.parseInt(channel, 16);

      return Math.round(value + (255 - value) * amount)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");

  return `#${lifted}`;
}
