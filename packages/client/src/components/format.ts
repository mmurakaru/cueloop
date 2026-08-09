/** Shared text formatting for the component system. */

export function truncate(value: string, maxLength: number): string {
  const oneLine = value.replace(/\n/g, " ");
  return oneLine.length > maxLength ? oneLine.slice(0, maxLength - 1) + "…" : oneLine;
}
