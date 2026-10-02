/** Truncate text to one line of at most maxLength characters, ellipsis-terminated. */

export function truncateToSingleLine(value: string, maxLength: number): string {
  const oneLine = value.replace(/\n/g, " ");

  return oneLine.length > maxLength ? oneLine.slice(0, maxLength - 1) + "…" : oneLine;
}
