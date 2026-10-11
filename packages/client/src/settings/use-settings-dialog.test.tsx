import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { expect, test } from "bun:test";
import React, { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../appearance/theme";
import { settle, locateText, typeText } from "../testing/test-support";
import { SettingsDialog } from "./components/SettingsDialog";
import { useSettingsDialog } from "./use-settings-dialog";

function TestThreadSettings({
  enabled,
  onSwitch,
}: {
  enabled: boolean;
  onSwitch: (harness: string) => void;
}) {
  const [harness, setHarness] = useState<"pi" | "fx">("pi");
  const [threadDefaults, setThreadDefaults] = useState(() => {
    const config = loadConfig();

    return { pi: config.thread.pi, fx: config.thread.fx };
  });
  const model = useSettingsDialog({
    threadDefaults,
    setThreadDefaults,
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
    canSwitchHarness: enabled,
    threadHarness: harness,
    onSwitchHarness(next) {
      setHarness(next);
      onSwitch(next);
    },
  });

  useKeyboard((key) => model.handleSettingsKey(key.name));

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

test("Thread settings switches harness by mouse and disappears without owner capability", async () => {
  const changes: string[] = [];
  const setup = await testRender(
    <TestThreadSettings enabled onSwitch={(next) => changes.push(next)} />,
    { width: 90, height: 28 },
  );

  try {
    await settle(setup);
    const category = locateText(setup, "Thread");

    await setup.mockMouse.click(category.column, category.row);
    await settle(setup);
    const row = locateText(setup, "Harness");

    await setup.mockMouse.click(row.column, row.row);
    await settle(setup);
    expect(changes).toEqual(["fx"]);
    expect(setup.captureCharFrame()).toContain("fx");
    await setup.mockMouse.click(row.column, row.row);
    await settle(setup);
    expect(changes).toEqual(["fx", "pi"]);
  } finally {
    setup.renderer.destroy();
  }
  const disabled = await testRender(<TestThreadSettings enabled={false} onSwitch={() => {}} />, {
    width: 90,
    height: 28,
  });

  try {
    await settle(disabled);
    expect(disabled.captureCharFrame()).not.toContain("Thread");
  } finally {
    disabled.renderer.destroy();
  }
});

test("Thread settings edits model defaults and effort and persists them to TOML", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-settings-model-"));
  const previous = process.env.CUELOOP_CONFIG;
  const path = join(directory, "config.toml");

  process.env.CUELOOP_CONFIG = path;
  const setup = await testRender(<TestThreadSettings enabled onSwitch={() => {}} />, {
    width: 100,
    height: 30,
  });

  try {
    await settle(setup);
    const category = locateText(setup, "Thread");

    await setup.mockMouse.click(category.column, category.row);
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("gpt-6.1-sol");
    expect(setup.captureCharFrame()).toContain("grok-4.7");
    const effort = locateText(setup, "pi default effort");

    await setup.mockMouse.click(effort.column, effort.row);
    await settle(setup);
    expect(loadConfig({ userConfigPath: path }).thread.pi.effort).toBe("high");
    const model = locateText(setup, "pi default model");

    await setup.mockMouse.click(model.column, model.row);
    await settle(setup);
    await typeText(setup, "-custom");
    await settle(setup);
    const save = locateText(setup, "save");

    await setup.mockMouse.click(save.column, save.row);
    await settle(setup);
    expect(loadConfig({ userConfigPath: path }).thread.pi.model).toBe(
      "openai-codex/gpt-6.1-sol-custom",
    );
    expect(setup.captureCharFrame()).toContain("gpt-6.1-sol-custom");
    const fxModel = locateText(setup, "fx default model");

    await setup.mockMouse.click(fxModel.column, fxModel.row);
    await settle(setup);
    await typeText(setup, "-cancelled");
    setup.mockInput.pressKey("ESC");
    await settle(setup);
    expect(setup.captureCharFrame()).not.toContain("Default model for new Threads");
    expect(loadConfig({ userConfigPath: path }).thread.fx).toEqual({
      model: "grok/grok-4.7",
      effort: "medium",
    });
  } finally {
    setup.renderer.destroy();

    if (previous === undefined) delete process.env.CUELOOP_CONFIG;
    else process.env.CUELOOP_CONFIG = previous;

    rmSync(directory, { recursive: true, force: true });
  }
});
