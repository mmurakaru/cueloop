import { expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as promises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiffWatcher } from "./diff-watcher";

const directoryReads: {
  readdir: (path: fs.PathLike, options: { withFileTypes: true }) => Promise<fs.Dirent[]>;
} = promises;

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

test("closing during startup reconciliation cancels the pending refresh", async () => {
  const repo = fs.mkdtempSync(join(tmpdir(), "cueloop-watch-close-"));
  const scanStarted = Promise.withResolvers<void>();
  const scanFinished = Promise.withResolvers<fs.Dirent[]>();
  const refresh = mock(() => {});
  const watcher = new DiffWatcher(refresh);
  const spy = spyOn(directoryReads, "readdir").mockImplementation(() => {
    scanStarted.resolve();

    return scanFinished.promise;
  });

  try {
    watcher.trackDiffRepo(repo, "session");
    await scanStarted.promise;
    watcher.close();
    scanFinished.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    scanFinished.resolve([]);
    watcher.close();
    spy.mockRestore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("replacing a watch during reconciliation stops the old directory traversal", async () => {
  const repo = fs.mkdtempSync(join(tmpdir(), "cueloop-watch-replace-"));
  const first = join(repo, "a");
  const next = join(repo, "b");

  fs.mkdirSync(first);
  fs.mkdirSync(next);
  const scanStarted = Promise.withResolvers<void>();
  const scanFinished = Promise.withResolvers<fs.Dirent[]>();
  const scanned: string[] = [];
  const watcher = new DiffWatcher(() => {});
  const spy = spyOn(directoryReads, "readdir").mockImplementation((path) => {
    scanned.push(String(path));

    if (path === first) {
      scanStarted.resolve();

      return scanFinished.promise;
    }

    return Promise.resolve(fs.readdirSync(path, { withFileTypes: true }));
  });

  try {
    watcher.trackDiffRepo(repo, "old");
    await scanStarted.promise;
    watcher.untrackDiffRepo(repo, "old");
    watcher.trackDiffRepo(repo, "replacement");
    scanFinished.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scanned).not.toContain(next);
  } finally {
    scanFinished.resolve([]);
    watcher.close();
    spy.mockRestore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
