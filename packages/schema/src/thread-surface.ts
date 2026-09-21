export type ThreadSurfaceOpenStatus = "opened" | "focused" | "disabled" | "unavailable" | "failed";

/** Give a harness the same manual command when any terminal integration cannot open. */
export function manualThreadOpenCommand(threadId: string): string {
  return `Open cueloop threads: cueloop ${threadId}`;
}
