import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_KEYS,
  DEFAULT_QUICK_ACTIONS,
  actionFor,
  loadConfig,
  persistAuthorName,
  persistActions,
  persistLayout,
  persistPins,
  persistReviewSkill,
  persistReviewWorkspace,
  persistTheme,
  quickActionBody,
  resolveQuickAction,
} from "./config";
import { DARK } from "./theme";
import { themeForName } from "./theme-presets";

describe("loadConfig", () => {
  test("review defaults use the bundled skill in an isolated worktree", () => {
    const config = loadConfig({ userConfigPath: "/nonexistent/config.toml" });

    expect(config.review).toEqual({ skill: "code-review", workspace: "worktree" });
  });

  test("review settings load and persist without changing other tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-review-config-"));
    const path = join(dir, "config.toml");

    writeFileSync(path, '[ui]\ntheme = "cueloop"\n\n[review]\nskill = "my-review"\n');
    try {
      persistReviewSkill("code-review", path);
      persistReviewWorkspace("current", path);

      expect(loadConfig({ userConfigPath: path }).review).toEqual({
        skill: "code-review",
        workspace: "current",
      });
      expect(readFileSync(path, "utf8")).toContain('[ui]\ntheme = "cueloop"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("review settings update a table whose header has a comment", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-review-commented-config-"));
    const path = join(dir, "config.toml");

    writeFileSync(path, '[review] # preferred settings\nskill = "my-review"\n');
    try {
      persistReviewSkill("code-review", path);

      const text = readFileSync(path, "utf8");

      expect(loadConfig({ userConfigPath: path }).review.skill).toBe("code-review");
      expect(text.match(/^\[review\]/gm)).toHaveLength(1);
      expect(text).toContain("[review] # preferred settings");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
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

  test("[ui] diff_view defaults to split and parses stacked", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-diff-"));
    const path = join(dir, "config.toml");

    writeFileSync(path, `[ui]\ndiff_view = "stacked"\n`);

    try {
      // Assert
      expect(loadConfig({ userConfigPath: "/nonexistent/config.toml" }).ui.diffView).toBe("split");
      expect(loadConfig({ userConfigPath: path }).ui.diffView).toBe("stacked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[ui] default_message defaults to approve and parses changes_requested", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-message-"));
    const path = join(dir, "config.toml");

    writeFileSync(path, `[ui]\ndefault_message = "changes_requested"\n`);

    try {
      // Assert
      expect(loadConfig({ userConfigPath: "/nonexistent/config.toml" }).ui.defaultMessage).toBe(
        "approved",
      );
      expect(loadConfig({ userConfigPath: path }).ui.defaultMessage).toBe("changes_requested");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[skills] path overrides the default and a malformed value never discards the config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-skills-"));
    const path = join(dir, "config.toml");

    try {
      writeFileSync(path, `[skills]\npath = "/custom/skills"\n`);
      expect(loadConfig({ userConfigPath: path }).skillsPath).toBe("/custom/skills");

      // a wrong-typed path falls back to the default without dropping the sibling [keys] setting
      writeFileSync(path, `[skills]\npath = 123\n\n[keys]\ncomment = "z"\n`);
      const config = loadConfig({ userConfigPath: path });

      expect(config.keys["comment"]).toEqual(["z"]);
      expect(config.skillsPath).toContain(".agents");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[ui] diff_view loads the pre-rename "unified" value as "stacked"', () => {
    // Arrange - an upgrade must not flip a user who had persisted the old spelling
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-diff-"));
    const path = join(dir, "config.toml");

    writeFileSync(path, `[ui]\ndiff_view = "unified"\n`);

    try {
      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.diffView).toBe("stacked");
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

  test("persistPins round-trips the pinned-thread ids through the config file", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-pins-"));
    const path = join(dir, "config.toml");

    try {
      // Act
      persistPins(["s_one", "s_two"], path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.pins).toEqual(["s_one", "s_two"]);

      // unpinning rewrites the list in place, including down to empty
      // Act
      persistPins(["s_two"], path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.pins).toEqual(["s_two"]);

      // Act
      persistPins([], path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.pins).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("persistLayout round-trips the remembered pane composition through the config file", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "cueloop-cfg-layout-"));
    const path = join(dir, "config.toml");

    try {
      // Act
      persistLayout({ threads: false, rightSidebar: "project", zoomChanges: false }, path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.layout).toEqual({
        threads: false,
        rightSidebar: "project",
        zoomChanges: false,
      });

      // Act
      persistLayout({ threads: true, rightSidebar: "off", zoomChanges: true }, path);

      // Assert
      expect(loadConfig({ userConfigPath: path }).ui.layout).toEqual({
        threads: true,
        rightSidebar: "off",
        zoomChanges: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("layout is unset until the user changes one", () => {
    // Assert
    expect(loadConfig({ userConfigPath: "/nonexistent/config.toml" }).ui.layout).toBeUndefined();
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
      `[integrations.obsidian]\nvault = "/notes/vault"\nfolder = "plans"\nexportOn = "approved"\nseparator = "comma"\n`,
    );

    try {
      // Act
      const config = loadConfig({ userConfigPath: path });

      // Assert
      expect(config.integrations.obsidian.vault).toBe("/notes/vault");
      expect(config.integrations.obsidian.folder).toBe("plans");
      expect(config.integrations.obsidian.exportOn).toBe("approved");
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

    writeFileSync(user, `[integrations.obsidian]\nvault = "/user/vault"\nexportOn = "message"\n`);
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
      expect(config.integrations.obsidian.exportOn).toBe("message");
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
    expect(config.actions).toHaveLength(8);
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

describe("the /lgtm default quick action", () => {
  test("expands to a terse approving note", () => {
    const lgtm = DEFAULT_QUICK_ACTIONS.find((action) => action.prompt.toLowerCase() === "lgtm");

    expect(lgtm).toBeDefined();
    // the reference is /lgtm, so the label is the prompt; it expands like every action (label, then note)
    expect(quickActionBody(lgtm!)).toBe("LGTM\n\nThis looks good to me.");
  });
});
