import { expect, test } from "bun:test";
import React, { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../appearance/theme";
import { settle, locateText } from "../testing/test-support";
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
  const model = useSettingsDialog({
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
