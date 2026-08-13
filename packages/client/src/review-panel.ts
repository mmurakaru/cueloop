/**
 * Pure geometry and state for the resizable review panel. The panel shows the
 * review rail in one of three modes and the expanded rail resizes within a
 * clamp; App owns the React state and the mouse wiring, this module owns the
 * arithmetic so the layout math stays unit-tested and out of the JSX. Bounds
 * and the compact width carry over verbatim from the approved prototype.
 */

/** Expanded (full rail), compact (count + dots strip), or hidden (nothing). */
export type ReviewPanelMode = "expanded" | "compact" | "hidden";

/** Expanded-rail width bounds, in terminal columns. */
export const REVIEW_MIN_WIDTH = 24;
export const REVIEW_MAX_WIDTH = 50;
export const REVIEW_DEFAULT_WIDTH = 34;
/**
 * Columns the plan/diff column keeps for itself: the expanded rail yields past
 * this so a narrow terminal (or a wide persisted width) can never crowd the
 * plan out to nothing - the whole reason the panel is resizable. On terminals
 * wide enough for the full 50-col rail this bound never binds.
 */
export const REVIEW_PLAN_MIN_WIDTH = 30;
/** The compact strip is a fixed narrow column: count on top, one dot per card. */
export const REVIEW_COMPACT_WIDTH = 6;
/** Keyboard resize step, in columns, for the widen/narrow keys. */
export const REVIEW_RESIZE_STEP = 2;

/** Round a desired width to a whole column and clamp it to the bounds. */
export function clampWidth(desiredWidth: number, min = REVIEW_MIN_WIDTH, max = REVIEW_MAX_WIDTH): number {
  return Math.max(min, Math.min(max, Math.round(desiredWidth)));
}

/**
 * The widest the expanded rail may be on a given terminal, reserving the plan
 * its minimum and one column for the divider. Never drops below REVIEW_MIN_WIDTH
 * (an extremely narrow terminal is the auto-collapse case, handled elsewhere).
 */
export function maxWidthForTerminal(terminalWidth: number): number {
  return Math.max(REVIEW_MIN_WIDTH, Math.min(REVIEW_MAX_WIDTH, terminalWidth - REVIEW_PLAN_MIN_WIDTH - 1));
}

/** Clamp a desired rail width to the bounds AND the terminal, so the plan keeps its room. */
export function resolveReviewWidth(desiredWidth: number, terminalWidth: number): number {
  return clampWidth(desiredWidth, REVIEW_MIN_WIDTH, maxWidthForTerminal(terminalWidth));
}

/** The keybinding cycle: expanded -> compact -> hidden -> expanded. */
export function cycleReviewPanelMode(mode: ReviewPanelMode): ReviewPanelMode {
  return mode === "expanded" ? "compact" : mode === "compact" ? "hidden" : "expanded";
}

/**
 * The clickable chevron toggles only between expanded and compact - hidden is
 * reachable by keybinding alone, so it never leaves a leftover tab behind. A
 * toggle from hidden still opens the panel rather than doing nothing.
 */
export function toggleReviewPanelMode(mode: ReviewPanelMode): ReviewPanelMode {
  return mode === "expanded" ? "compact" : "expanded";
}

/**
 * Rail width from an absolute mouse column while dragging the divider: the rail
 * spans from the mouse column to the terminal's right edge, then clamps.
 */
export function widthFromMouseColumn(mouseColumn: number, terminalWidth: number): number {
  return resolveReviewWidth(terminalWidth - mouseColumn, terminalWidth);
}

/**
 * The divider is a single-column stack of vertical glyphs (a text block, not a
 * bordered box - a one-column box with a border renders a full box). One glyph
 * per row, at least one so the column never collapses.
 */
export function reviewRowsToDivider(rows: number): string {
  return Array.from({ length: Math.max(1, rows) }, () => "│").join("\n");
}
