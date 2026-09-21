/** Shared UX contract for opening the canonical cueloop Thread in a terminal. */

/** Terminal integrations report whether a Thread opened, focused, or needs manual action. */
export type ThreadSurfaceOpenStatus = "opened" | "focused" | "disabled" | "unavailable" | "failed";

/** Give a harness the same manual command when any terminal integration cannot open. */
export function manualThreadOpenCommand(threadId: string): string {
  return `Open cueloop threads: cueloop ${threadId}`;
}
