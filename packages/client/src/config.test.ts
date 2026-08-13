import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KEYS, actionFor, loadConfig, persistReviewState, persistReviewWidth } from "./config";
import { REVIEW_DEFAULT_WIDTH, REVIEW_MAX_WIDTH } from "./review-panel";
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

  test("[ui] parses auto_close and the editor override", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg4-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\nauto_close = 3\neditor = "code --wait"\n`);
    try {
      const config = loadConfig({ userConfigPath: path });
      expect(config.ui.autoClose).toBe(3);
      expect(config.ui.editor).toBe("code --wait");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] editor defaults to undefined and ignores a blank value", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg5-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\neditor = "   "\n`);
    try {
      expect(loadConfig({ userConfigPath: "/nonexistent/config.toml" }).ui.editor).toBeUndefined();
      expect(loadConfig({ userConfigPath: path }).ui.editor).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] review panel defaults to an expanded rail at the default width", () => {
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });
    expect(config.ui.reviewState).toBe("expanded");
    expect(config.ui.reviewWidth).toBe(REVIEW_DEFAULT_WIDTH);
  });

  test("[ui] parses review_width (clamped) and review_state", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg6-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\nreview_width = 999\nreview_state = "compact"\n`);
    try {
      const config = loadConfig({ userConfigPath: path });
      expect(config.ui.reviewWidth).toBe(REVIEW_MAX_WIDTH); // out-of-range width clamps
      expect(config.ui.reviewState).toBe("compact");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] ignores an unknown review_state and a non-numeric width", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg7-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\nreview_width = "wide"\nreview_state = "sideways"\n`);
    try {
      const config = loadConfig({ userConfigPath: path });
      expect(config.ui.reviewWidth).toBe(REVIEW_DEFAULT_WIDTH);
      expect(config.ui.reviewState).toBe("expanded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("persistReviewWidth and persistReviewState round-trip through the config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg8-"));
    const path = join(dir, "config.toml");
    try {
      persistReviewWidth(42, path);
      persistReviewState("hidden", path);
      const config = loadConfig({ userConfigPath: path });
      expect(config.ui.reviewWidth).toBe(42);
      expect(config.ui.reviewState).toBe("hidden");
      // a second write replaces the key in place rather than appending a duplicate
      persistReviewWidth(30, path);
      expect(loadConfig({ userConfigPath: path }).ui.reviewWidth).toBe(30);
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
