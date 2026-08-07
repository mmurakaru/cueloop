import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVaults, obsidianConfigPath } from "./detect";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cueloop-obsidian-detect-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("detectVaults", () => {
  test("returns registered vault paths that exist on disk", () => {
    const alive = join(dir, "notes");
    mkdirSync(alive);
    const gone = join(dir, "deleted-vault");
    const configPath = join(dir, "obsidian.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        vaults: {
          abc123: { path: alive, ts: 1700000000000, open: true },
          def456: { path: gone, ts: 1700000000001 },
        },
      }),
    );
    expect(detectVaults(configPath)).toEqual([alive]);
  });

  test("missing or malformed config yields no vaults", () => {
    expect(detectVaults(join(dir, "nope.json"))).toEqual([]);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "not json");
    expect(detectVaults(broken)).toEqual([]);
    const empty = join(dir, "empty.json");
    writeFileSync(empty, "{}");
    expect(detectVaults(empty)).toEqual([]);
  });
});

describe("obsidianConfigPath", () => {
  test("resolves per platform", () => {
    expect(obsidianConfigPath("darwin")).toContain(join("Library", "Application Support", "obsidian", "obsidian.json"));
    expect(obsidianConfigPath("linux")).toContain(join("obsidian", "obsidian.json"));
    expect(obsidianConfigPath("win32")).toContain(join("obsidian", "obsidian.json"));
  });
});
