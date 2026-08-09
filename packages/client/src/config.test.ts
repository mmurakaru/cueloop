import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KEYS, actionFor, loadConfig } from "./config";
import { DARK } from "./theme";

describe("loadConfig", () => {
  test("defaults when no file exists", () => {
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });
    expect(config.keys["comment"]).toEqual(["c"]);
    expect(config.theme.accent).toBe(DARK.accent);
  });

  test("user config rebinds actions and overrides theme tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[keys]\ncomment = "a"\nsubmit = ["return", "S"]\n\n[theme]\naccent = "#ff0000"\n`,
    );
    try {
      const config = loadConfig({ userConfigPath: path });
      expect(config.keys["comment"]).toEqual(["a"]);
      expect(config.keys["submit"]).toEqual(["return", "S"]);
      expect(config.keys["cut"]).toEqual(["x"]); // untouched defaults survive
      expect(config.theme.accent).toBe("#ff0000");
      expect(config.theme.green).toBe(DARK.green);
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
      const config = loadConfig({ userConfigPath: user, repoRoot });
      expect(config.keys["comment"]).toEqual(["z"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("broken config never blocks a review", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg3-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, "not [valid toml");
    try {
      const config = loadConfig({ userConfigPath: path });
      expect(config.keys["comment"]).toEqual(["c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("integrations.obsidian config", () => {
  test("defaults when the section is absent", () => {
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });
    expect(config.integrations.obsidian.vault).toBeUndefined();
    expect(config.integrations.obsidian.folder).toBe("cueloop");
    expect(config.integrations.obsidian.filenameFormat).toBe("{YYYY}-{MM}-{DD} - {title}");
    expect(config.integrations.obsidian.separator).toBe("space");
    expect(config.integrations.obsidian.exportOn).toBe("manual");
  });

  test("user config sets the section; invalid enum values are ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-obs-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[integrations.obsidian]\nvault = "/notes/vault"\nfolder = "plans"\nexportOn = "approve"\nseparator = "comma"\n`,
    );
    try {
      const config = loadConfig({ userConfigPath: path });
      expect(config.integrations.obsidian.vault).toBe("/notes/vault");
      expect(config.integrations.obsidian.folder).toBe("plans");
      expect(config.integrations.obsidian.exportOn).toBe("approve");
      expect(config.integrations.obsidian.separator).toBe("space"); // invalid value falls back
      expect(config.keys["comment"]).toEqual(["c"]); // other sections untouched
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
      const config = loadConfig({ userConfigPath: user, repoRoot });
      expect(config.integrations.obsidian.vault).toBe("/user/vault"); // user layer survives
      expect(config.integrations.obsidian.exportOn).toBe("resolve");
      expect(config.integrations.obsidian.folder).toBe("repo-plans"); // repo layer wins
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
