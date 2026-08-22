import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_KEYS,
  DEFAULT_QUICK_ACTIONS,
  actionFor,
  loadConfig,
  persistAuthorName,
  persistReviewState,
  persistActions,
  persistReviewWidth,
  persistTheme,
  quickActionBody,
  resolveQuickAction,
} from "./config";
import { REVIEW_DEFAULT_WIDTH, REVIEW_MAX_WIDTH } from "./review-panel";
import { DARK } from "./theme";
import { themeForName } from "./theme-presets";

describe("loadConfig", () => {
  test("defaults when no file exists", () => {
    // Act
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });

    // Assert
    expect(config.keys["comment"]).toEqual(["c"]);
    expect(config.theme.accent).toBe(DARK.accent);
  });

  test("user config rebinds actions and overrides theme tokens", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[keys]\ncomment = "a"\nsubmit = ["return", "S"]\n\n[theme]\naccent = "#ff0000"\n`,
    );

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
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
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg2-"));
    const user = join(dir, "user.toml");
    const repoRoot = join(dir, "repo");
    writeFileSync(user, `[keys]\ncomment = "a"\n`);
    Bun.spawnSync(["mkdir", "-p", join(repoRoot, ".cueloop")]);
    writeFileSync(join(repoRoot, ".cueloop", "config.toml"), `[keys]\ncomment = "z"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: user, repoRoot });

      // Assert
      expect(config.keys["comment"]).toEqual(["z"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("broken config never blocks a review", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg3-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, "not [valid toml");

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.keys["comment"]).toEqual(["c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] parses auto_close and the editor override", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg4-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\nauto_close = 3\neditor = "code --wait"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.ui.autoClose).toBe(3);
      expect(config.ui.editor).toBe("code --wait");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] editor defaults to undefined and ignores a blank value", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg5-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\neditor = "   "\n`);

    try {
      // Assert
      expect(loadConfig({ userConfigPath: "/nonexistent/config.toml" }).ui.editor).toBeUndefined();
      expect(loadConfig({ userConfigPath: path }).ui.editor).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] review panel defaults to an expanded rail at the default width", () => {
    // Act
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });

    // Assert
    expect(config.ui.reviewState).toBe("expanded");
    expect(config.ui.reviewWidth).toBe(REVIEW_DEFAULT_WIDTH);
  });

  test("[ui] parses review_width (clamped) and review_state", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg6-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\nreview_width = 999\nreview_state = "compact"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.ui.reviewWidth).toBe(REVIEW_MAX_WIDTH); // out-of-range width clamps
      expect(config.ui.reviewState).toBe("compact");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] ignores an unknown review_state and a non-numeric width", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg7-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\nreview_width = "wide"\nreview_state = "sideways"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.ui.reviewWidth).toBe(REVIEW_DEFAULT_WIDTH);
      expect(config.ui.reviewState).toBe("expanded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] theme defaults to the branded cueloop preset", () => {
    // Act
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });

    // Assert
    expect(config.ui.theme).toBe("cueloop");
    expect(config.theme.accent).toBe(DARK.accent);
  });

  test("[ui] theme selects a named preset as the token base", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-theme-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\ntheme = "nord"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.ui.theme).toBe("nord");
      expect(config.theme).toEqual(themeForName("nord"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[theme] token overrides layer on top of the selected preset", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-theme2-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\ntheme = "nord"\n\n[theme]\naccent = "#ff0000"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.theme.accent).toBe("#ff0000"); // override wins
      expect(config.theme.background).toBe(themeForName("nord").background); // preset base survives
      expect(config.themeOverrides).toEqual({ accent: "#ff0000" }); // deltas exposed for live re-compose
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a later file's preset keeps an earlier file's [theme] override", () => {
    // Arrange - user overrides accent; repo picks a preset in a separate file
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-theme-x-"));
    const user = join(dir, "user.toml");
    const repoRoot = join(dir, "repo");
    writeFileSync(user, `[theme]\naccent = "#ff0000"\n`);
    Bun.spawnSync(["mkdir", "-p", join(repoRoot, ".cueloop")]);
    writeFileSync(join(repoRoot, ".cueloop", "config.toml"), `[ui]\ntheme = "nord"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: user, repoRoot });

      // Assert - the preset is the base, but the earlier override still wins its token
      expect(config.ui.theme).toBe("nord");
      expect(config.theme.background).toBe(themeForName("nord").background);
      expect(config.theme.accent).toBe("#ff0000");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] ignores an unknown theme name and keeps the default", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-theme3-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[ui]\ntheme = "solarized-galaxy"\n`);

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.ui.theme).toBe("cueloop");
      expect(config.theme.accent).toBe(DARK.accent);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("persistTheme round-trips through the config file", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-theme4-"));
    const path = join(dir, "config.toml");

    try {
      // Act
      persistTheme("tokyo-night", path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.theme).toBe("tokyo-night");

      // a second write replaces the key in place
      // Act
      persistTheme("gruvbox-dark", path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.theme).toBe("gruvbox-dark");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("persistReviewWidth and persistReviewState round-trip through the config file", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg8-"));
    const path = join(dir, "config.toml");

    try {
      // Act
      persistReviewWidth(42, path);
      persistReviewState("hidden", path);

      // Assert
      const config = loadConfig({ userConfigPath: path });
      expect(config.ui.reviewWidth).toBe(42);
      expect(config.ui.reviewState).toBe("hidden");

      // a second write replaces the key in place rather than appending a duplicate
      // Act
      persistReviewWidth(30, path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.reviewWidth).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("integrations.obsidian config", () => {
  test("defaults when the section is absent", () => {
    // Act
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });

    // Assert
    expect(config.integrations.obsidian.vault).toBeUndefined();
    expect(config.integrations.obsidian.folder).toBe("cueloop");
    expect(config.integrations.obsidian.filenameFormat).toBe("{YYYY}-{MM}-{DD} - {title}");
    expect(config.integrations.obsidian.separator).toBe("space");
    expect(config.integrations.obsidian.exportOn).toBe("manual");
  });

  test("user config sets the section; invalid enum values are ignored", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-obs-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[integrations.obsidian]\nvault = "/notes/vault"\nfolder = "plans"\nexportOn = "approve"\nseparator = "comma"\n`,
    );

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
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
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-obs2-"));
    const user = join(dir, "user.toml");
    const repoRoot = join(dir, "repo");
    writeFileSync(user, `[integrations.obsidian]\nvault = "/user/vault"\nexportOn = "resolve"\n`);
    Bun.spawnSync(["mkdir", "-p", join(repoRoot, ".cueloop")]);
    writeFileSync(
      join(repoRoot, ".cueloop", "config.toml"),
      `[integrations.obsidian]\nfolder = "repo-plans"\n`,
    );

    try {
      // Act
      const config = loadConfig({ userConfigPath: user, repoRoot });

      // Assert
      expect(config.integrations.obsidian.vault).toBe("/user/vault"); // user layer survives
      expect(config.integrations.obsidian.exportOn).toBe("resolve");
      expect(config.integrations.obsidian.folder).toBe("repo-plans"); // repo layer wins
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("quick actions ([[actions]])", () => {
  test("absent config keeps the built-in defaults", () => {
    // Act
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });

    // Assert
    expect(config.actions).toEqual(DEFAULT_QUICK_ACTIONS);
    expect(config.actions).toHaveLength(7);
  });

  test("configured actions replace the defaults, with optional metadata", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-actions-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[[actions]]\nprompt = "Add a benchmark"\n\n[[actions]]\nprompt = "Guard the edge case"\nmetadata = "null and empty input"\n`,
    );

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.actions).toEqual([
        { prompt: "Add a benchmark" },
        { prompt: "Guard the edge case", metadata: "null and empty input" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a table missing prompt is skipped; the rest replace the defaults", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-actions2-"));
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[[actions]]\nmetadata = "orphan without a prompt"\n\n[[actions]]\nprompt = "Keep this one"\n`,
    );

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.actions).toEqual([{ prompt: "Keep this one" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("persistActions", () => {
  test("round-trips the action set through [[actions]] and replaces prior ones", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-persist-actions-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[[actions]]\nprompt = "old one"\n\n[ui]\nauto_close = 3\n`);

    try {
      // Act
      persistActions(
        [{ prompt: "Zoom out" }, { prompt: "Prototype", metadata: "skip tests and polish" }],
        path,
      );
      const config = loadConfig({ userConfigPath: path });

      // Assert - the old action is gone, the new set is read back, and [ui] survives
      expect(config.actions).toEqual([
        { prompt: "Zoom out" },
        { prompt: "Prototype", metadata: "skip tests and polish" },
      ]);
      expect(config.ui.autoClose).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("quickActionBody", () => {
  test("appends the system prompt below the prompt when set", () => {
    // Assert
    expect(quickActionBody({ prompt: "Prototype this", metadata: "skip tests" })).toBe(
      "Prototype this\n\nskip tests",
    );
    expect(quickActionBody({ prompt: "Out of scope" })).toBe("Out of scope");
  });
});

describe("resolveQuickAction", () => {
  test("resolves by 1-based index and by case-insensitive prompt", () => {
    // Assert
    expect(resolveQuickAction(DEFAULT_QUICK_ACTIONS, "1")).toEqual(DEFAULT_QUICK_ACTIONS[0]!);
    expect(resolveQuickAction(DEFAULT_QUICK_ACTIONS, "out of scope")).toEqual(
      DEFAULT_QUICK_ACTIONS[2]!,
    );
  });

  test("returns undefined for an out-of-range index or an unknown name", () => {
    // Assert
    expect(resolveQuickAction(DEFAULT_QUICK_ACTIONS, "0")).toBeUndefined();
    expect(resolveQuickAction(DEFAULT_QUICK_ACTIONS, "99")).toBeUndefined();
    expect(resolveQuickAction(DEFAULT_QUICK_ACTIONS, "no such action")).toBeUndefined();
  });
});

describe("actionFor", () => {
  test("resolves keys and shifted keys to actions", () => {
    // Assert
    expect(actionFor(DEFAULT_KEYS, "j", false)).toBe("down");
    expect(actionFor(DEFAULT_KEYS, "g", true)).toBe("bottom"); // G
    expect(actionFor(DEFAULT_KEYS, "return", false)).toBe("submit");
    expect(actionFor(DEFAULT_KEYS, "zz", false)).toBeUndefined();
  });
});

describe("[authors] rename map", () => {
  test("loads quoted fingerprint keys", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-authors-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, `[authors]\n"SHA256:abc+def/gh" = "Alex"\n`);

    // Act
    const config = loadConfig({ userConfigPath: path });

    // Assert
    expect(config.authors["SHA256:abc+def/gh"]).toBe("Alex");
    rmSync(dir, { recursive: true, force: true });
  });

  test("persistAuthorName round-trips and updates a fingerprint id in place", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-authors2-"));
    const path = join(dir, "config.toml");

    // Act / Assert
    persistAuthorName("SHA256:abc+def/gh", "Alex", path);
    expect(loadConfig({ userConfigPath: path }).authors["SHA256:abc+def/gh"]).toBe("Alex");
    persistAuthorName("SHA256:abc+def/gh", "Alexa", path);
    expect(loadConfig({ userConfigPath: path }).authors["SHA256:abc+def/gh"]).toBe("Alexa");
    rmSync(dir, { recursive: true, force: true });
  });
});
