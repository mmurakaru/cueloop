import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGhosttyThreadSurface, loadHerdrThreadSurface } from "./thread-surface-config";

let dir: string;
let userPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-config-"));
  userPath = join(dir, "user.toml");
});

describe("personal Ghostty Thread surface config", () => {
  test("defaults to tab and accepts pane, window, or none", () => {
    expect(loadGhosttyThreadSurface(userPath)).toBe("tab");

    for (const mode of ["pane", "window", "none"] as const) {
      writeFileSync(userPath, `[integrations.ghostty]\nthread_surface = "${mode}"\n`);
      expect(loadGhosttyThreadSurface(userPath)).toBe(mode);
    }

    writeFileSync(userPath, '[integrations.ghostty]\nthread_surface = "invalid"\n');
    expect(loadGhosttyThreadSurface(userPath)).toBe("tab");
  });

  test("ignores repository config", () => {
    const repoConfig = join(dir, "repo", ".cueloop", "config.toml");

    mkdirSync(join(dir, "repo", ".cueloop"), { recursive: true });
    writeFileSync(userPath, '[integrations.ghostty]\nthread_surface = "window"\n');
    writeFileSync(repoConfig, '[integrations.ghostty]\nthread_surface = "none"\n');

    expect(loadGhosttyThreadSurface(userPath)).toBe("window");
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("personal Herdr Thread surface config", () => {
  test("defaults to tab and accepts pane or none", () => {
    expect(loadHerdrThreadSurface(userPath)).toBe("tab");
    writeFileSync(userPath, '[integrations.herdr]\nthread_surface = "pane"\n');
    expect(loadHerdrThreadSurface(userPath)).toBe("pane");
    writeFileSync(userPath, '[integrations.herdr]\nthread_surface = "none"\n');
    expect(loadHerdrThreadSurface(userPath)).toBe("none");
    writeFileSync(userPath, '[integrations.herdr]\nthread_surface = "invalid"\n');
    expect(loadHerdrThreadSurface(userPath)).toBe("tab");
  });

  test("never reads a repository's terminal automation setting", () => {
    const repoConfig = join(dir, "repo", ".cueloop", "config.toml");

    mkdirSync(join(dir, "repo", ".cueloop"), { recursive: true });
    writeFileSync(userPath, '[integrations.herdr]\nthread_surface = "pane"\n');
    writeFileSync(repoConfig, '[integrations.herdr]\nthread_surface = "none"\n');

    expect(loadHerdrThreadSurface(userPath)).toBe("pane");
  });
});
