/** Fits a thread title on one line: unchanged when it fits, otherwise clipped to an ellipsis. */
export function truncateTitle(title: string, maxWidth: number): string {
  const oneLine = title.replace(/\n/g, " ");

  if (maxWidth <= 0) return "";
  if (oneLine.length <= maxWidth) return oneLine;

  return `${oneLine.slice(0, Math.max(0, maxWidth - 1))}…`;
}
