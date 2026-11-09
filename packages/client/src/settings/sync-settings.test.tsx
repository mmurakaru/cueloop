import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { loadConfig, persistExperimentalSync } from "./config";
import { useSettingsDialog } from "./use-settings-dialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { DARK } from "../appearance/theme";
import { settle, locateText } from "../testing/test-support";

test("sync requires an explicit boolean flag and preserves other configuration when changed", () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-setting-"));
  const path = join(directory, "config.toml");

  try {
    expect(loadConfig({ userConfigPath: path }).experimental.sync).toBe(false);
    writeFileSync(
      path,
      '[experimental]\nsync = "true"\nthread_agent = true\n[ui]\ntheme = "cueloop"\n',
    );
    expect(loadConfig({ userConfigPath: path }).experimental.sync).toBe(false);
    persistExperimentalSync(true, path);
    expect(loadConfig({ userConfigPath: path }).experimental.sync).toBe(true);
    expect(loadConfig({ userConfigPath: path }).experimental.threadAgent).toBe(true);
    expect(readFileSync(path, "utf8")).toContain('theme = "cueloop"');
    persistExperimentalSync(false, path);
    expect(loadConfig({ userConfigPath: path }).experimental.sync).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function TestSyncSettings() {
  const config = loadConfig();
  const [syncEnabled, setSyncEnabled] = useState(config.experimental.sync);
  const model = useSettingsDialog({
    syncEnabled,
    setSyncEnabled,
    threadDefaults: { pi: config.thread.pi, fx: config.thread.fx },
    setThreadDefaults() {},
    theme: DARK,
    appearance: "dark",
    autoClose: "off",
    setAutoClose() {},
    diffView: "split",
    setDiffView() {},
    themeName: "cueloop",
    setThemeName() {},
    themeOverrides: {},
    setTheme() {},
    quickActions: [],
    setQuickActions() {},
    setMenuDialog() {},
    identityProvider: "typed",
    onSyncGithubIdentity() {},
    onRenameDisplayName() {},
    reviewSkill: "code-review",
    reviewWorkspace: "worktree",
    setReviewWorkspace() {},
  });

  return (
    <SettingsDialog
      isOpen
      version="test"
      categories={model.settingsCategories}
      values={model.settingsValues}
      keybindsSections={[]}
      activeCategoryId={model.settingsNav.categoryId}
      activeRowIndex={model.settingsNav.rowIndex}
      activeZone={model.settingsNav.zone}
      onCategorySelect={model.onCategorySelect}
      onRowActivate={(row) => model.cycleSetting(row.key)}
      onClose={() => {}}
    />
  );
}

test("the Experimental settings category toggles and persists multiplayer sync", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-settings-ui-"));
  const previous = process.env.CUELOOP_CONFIG;
  const path = join(directory, "config.toml");

  process.env.CUELOOP_CONFIG = path;
  const setup = await testRender(<TestSyncSettings />, { width: 90, height: 28 });

  try {
    await settle(setup);
    const category = locateText(setup, "Experimental");

    await setup.mockMouse.click(category.column, category.row);
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("Multiplayer sync");
    expect(setup.captureCharFrame()).toContain("Off");
    const row = locateText(setup, "Multiplayer sync");

    await setup.mockMouse.click(row.column, row.row);
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("On");
    expect(loadConfig({ userConfigPath: path }).experimental.sync).toBe(true);
  } finally {
    setup.renderer.destroy();

    if (previous === undefined) delete process.env.CUELOOP_CONFIG;
    else process.env.CUELOOP_CONFIG = previous;

    rmSync(directory, { recursive: true, force: true });
  }
});
