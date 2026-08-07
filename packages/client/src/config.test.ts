import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KEYS, actionFor, loadConfig } from "./config";
import { DARK } from "./theme";

describe("loadConfig", () => {
  test("defaults when no file exists", () => {
    const c = loadConfig({ userConfigPath: "/nonexistent/config.toml" });
    expect(c.keys["comment"]).toEqual(["c"]);
    expect(c.theme.accent).toBe(DARK.accent);
  });

  test("user config rebinds actions and overrides theme tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[keys]\ncomment = "a"\nsubmit = ["return", "S"]\n\n[theme]\naccent = "#ff0000"\n`,
    );
    try {
      const c = loadConfig({ userConfigPath: path });
      expect(c.keys["comment"]).toEqual(["a"]);
      expect(c.keys["submit"]).toEqual(["return", "S"]);
      expect(c.keys["cut"]).toEqual(["x"]); // untouched defaults survive
      expect(c.theme.accent).toBe("#ff0000");
      expect(c.theme.green).toBe(DARK.green);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repo config layers over user config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg2-"));
    const user = join(dir, "user.toml");
    const repoRoot = join(dir, "repo");
    writeFileSync(user, `[keys]\ncomment = "a"\n`);
    Bun.spawnSync(["mkdir", "-p", join(repoRoot, ".cueloop")]);
    writeFileSync(join(repoRoot, ".cueloop", "config.toml"), `[keys]\ncomment = "z"\n`);
    try {
      const c = loadConfig({ userConfigPath: user, repoRoot });
      expect(c.keys["comment"]).toEqual(["z"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("broken config never blocks a review", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg3-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, "not [valid toml");
    try {
      const c = loadConfig({ userConfigPath: path });
      expect(c.keys["comment"]).toEqual(["c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("integrations.obsidian config", () => {
  test("defaults when the section is absent", () => {
    const c = loadConfig({ userConfigPath: "/nonexistent/config.toml" });
    expect(c.integrations.obsidian.vault).toBeUndefined();
    expect(c.integrations.obsidian.folder).toBe("cueloop");
    expect(c.integrations.obsidian.filenameFormat).toBe("{YYYY}-{MM}-{DD} - {title}");
    expect(c.integrations.obsidian.separator).toBe("space");
    expect(c.integrations.obsidian.exportOn).toBe("manual");
  });

  test("user config sets the section; invalid enum values are ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-obs-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[integrations.obsidian]\nvault = "/notes/vault"\nfolder = "plans"\nexportOn = "approve"\nseparator = "comma"\n`,
    );
    try {
      const c = loadConfig({ userConfigPath: path });
      expect(c.integrations.obsidian.vault).toBe("/notes/vault");
      expect(c.integrations.obsidian.folder).toBe("plans");
      expect(c.integrations.obsidian.exportOn).toBe("approve");
      expect(c.integrations.obsidian.separator).toBe("space"); // invalid value falls back
      expect(c.keys["comment"]).toEqual(["c"]); // other sections untouched
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repo config layers over user config for the section", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-obs2-"));
    const user = join(dir, "user.toml");
    const repoRoot = join(dir, "repo");
    writeFileSync(user, `[integrations.obsidian]\nvault = "/user/vault"\nexportOn = "resolve"\n`);
    Bun.spawnSync(["mkdir", "-p", join(repoRoot, ".cueloop")]);
    writeFileSync(join(repoRoot, ".cueloop", "config.toml"), `[integrations.obsidian]\nfolder = "repo-plans"\n`);
    try {
      const c = loadConfig({ userConfigPath: user, repoRoot });
      expect(c.integrations.obsidian.vault).toBe("/user/vault"); // user layer survives
      expect(c.integrations.obsidian.exportOn).toBe("resolve");
      expect(c.integrations.obsidian.folder).toBe("repo-plans"); // repo layer wins
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("actionFor", () => {
  test("resolves keys and shifted keys to actions", () => {
    expect(actionFor(DEFAULT_KEYS, "j", false)).toBe("down");
    expect(actionFor(DEFAULT_KEYS, "g", true)).toBe("bottom"); // G
    expect(actionFor(DEFAULT_KEYS, "return", false)).toBe("submit");
    expect(actionFor(DEFAULT_KEYS, "zz", false)).toBeUndefined();
  });
});
