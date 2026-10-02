import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiffWatcher } from "./diff-watcher";

test("startup reconciliation watches a directory whose creation event was missed", async () => {
  const repo = fs.mkdtempSync(join(tmpdir(), "cueloop-watch-startup-"));
  const watch = fs.watch;
  const listeners = new Map<string, fs.WatchListener<string>>();
  let refreshes = 0;
  const startup = Promise.withResolvers<void>();
  const change = Promise.withResolvers<void>();
  const watcher = new DiffWatcher(() => {
    refreshes++;
    if (refreshes === 1) startup.resolve();
    else change.resolve();
  });
  // SAFETY: DiffWatcher always calls the string-filename, three-argument watch overload.
  const spy = spyOn(fs, "watch").mockImplementation(((
    path: fs.PathLike,
    options: fs.WatchOptions,
    listener: fs.WatchListener<string>,
  ) => {
    listeners.set(String(path), listener);

    return watch(path, options, () => {});
  }) as typeof fs.watch);

  try {
    watcher.trackDiffRepo(repo, "session");
    fs.mkdirSync(join(repo, "nested"));
    await startup.promise;
    expect(refreshes).toBe(1);
    const onDirectoryChange = listeners.get(join(repo, "nested"));

    expect(onDirectoryChange).toBeDefined();
    fs.writeFileSync(join(repo, "nested", "inside.ts"), "export const inside = 1;\n");
    onDirectoryChange?.("change", "inside.ts");
    await change.promise;
    expect(refreshes).toBe(2);
  } finally {
    watcher.close();
    spy.mockRestore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
