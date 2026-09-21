import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHerdrThreadSurface } from "./thread-surface-config";

let dir: string;
let userPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-config-"));
  userPath = join(dir, "user.toml");
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
