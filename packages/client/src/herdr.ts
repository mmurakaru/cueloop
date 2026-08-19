/**
 * First-class herdr return: a review opened beside an agent hands focus back
 * to the agent's pane when it closes, not leaving the reviewer on a dead tab.
 * The env contract and the return-target rule live in @cueloop/schema; this
 * module owns the one reviewer-side action that spawns the herdr CLI. Focus
 * is best-effort - a failure never blocks closing the review.
 */

/** Focus the tab holding the target pane. Synchronous: runs just before exit. */
export function focusHerdrPane(binPath: string, paneId: string): boolean {
  try {
    const got = Bun.spawnSync([binPath, "pane", "get", paneId], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (got.exitCode !== 0) return false;
    const parsed = JSON.parse(got.stdout.toString()) as { result?: { pane?: { tab_id?: string } } };
    const tab = parsed.result?.pane?.tab_id;
    if (!tab) return false;
    return (
      Bun.spawnSync([binPath, "tab", "focus", tab], { stdout: "ignore", stderr: "ignore" })
        .exitCode === 0
    );
  } catch {
    return false;
  }
}
