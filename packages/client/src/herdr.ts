/**
 * First-class herdr return: a review opened beside an agent should hand
 * focus back to the agent's pane when it closes, not leave the reviewer on a
 * dead tab. Detection is the ambient env contract; the return target comes
 * from CUELOOP_RETURN_PANE (set by whoever opened this pane) or the session's
 * recorded herdrPane (set by the adapter hook). Everything here is
 * best-effort: focus failures never block closing the review.
 */

export function insideHerdr(): boolean {
  return process.env.HERDR_ENV === "1";
}

export function returnPaneFor(sessionHerdrPane?: string): string | undefined {
  if (!insideHerdr()) return undefined;
  const pane = process.env.CUELOOP_RETURN_PANE ?? sessionHerdrPane;
  // returning to our own pane would be a no-op at best
  return pane && pane !== process.env.HERDR_PANE_ID ? pane : undefined;
}

/** Focus the tab holding the target pane. Synchronous: runs just before exit. */
export function focusHerdrPane(paneId: string): boolean {
  const bin = process.env.HERDR_BIN_PATH ?? "herdr";
  try {
    const got = Bun.spawnSync([bin, "pane", "get", paneId], { stdout: "pipe", stderr: "ignore" });
    if (got.exitCode !== 0) return false;
    const parsed = JSON.parse(got.stdout.toString()) as { result?: { pane?: { tab_id?: string } } };
    const tab = parsed.result?.pane?.tab_id;
    if (!tab) return false;
    return Bun.spawnSync([bin, "tab", "focus", tab], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    return false;
  }
}
