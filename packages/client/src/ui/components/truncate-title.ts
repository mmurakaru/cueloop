/**
 * Fits a thread title on one line: unchanged when it fits, otherwise clipped to
 * an ellipsis. Slices by code point, not UTF-16 unit, so an emoji or other
 * astral character is never split into a replacement glyph.
 */
export function truncateTitle(title: string, maxWidth: number): string {
  const oneLine = title.replace(/\n/g, " ");

  if (maxWidth <= 0) return "";
  const characters = [...oneLine];

  if (characters.length <= maxWidth) return oneLine;

  return `${characters.slice(0, Math.max(0, maxWidth - 1)).join("")}…`;
}
