import React, { useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_QUICK_ACTIONS,
  persistActions,
  persistAutoClose,
  persistTheme,
  type AutoClose,
  type QuickAction,
} from "./config";
import {
  composeTheme,
  THEME_LABELS,
  THEME_NAMES,
  type Appearance,
  type ThemeName,
} from "./theme-presets";
import type { Theme } from "./theme";
import type { ReviewPanelMode } from "./review-panel";
import type { SettingsCategory } from "./components/SettingsDialog";
import { QuickActionsEditor } from "./components/quick-actions-editor";
import type { ReviewController } from "./session-controller";

export interface SettingsNav {
  categoryId: string;
  rowIndex: number;
  zone: "nav" | "body";
}

export interface SettingsDialogModel {
  settingsNav: SettingsNav;
  actionsExpandedIndex: number | null;
  setActionsExpandedIndex: Dispatch<SetStateAction<number | null>>;
  settingsCategories: SettingsCategory[];
  settingsValues: Record<string, string>;
  cycleSetting: (rowKey: string) => void;
  handleSettingsKey: (name: string) => void;
  onCategorySelect: (categoryId: string) => void;
}

const DOWN_KEYS = new Set(["j", "down"]);
const UP_KEYS = new Set(["k", "up"]);
const ENTER_BODY_KEYS = new Set(["l", "tab", "return"]);
const ACTIVATE_KEYS = new Set(["return", "space", "l"]);

function moveNavZone(
  name: string,
  categoryIndex: number,
  categories: SettingsCategory[],
): SettingsNav | null {
  if (DOWN_KEYS.has(name))
    return {
      categoryId: categories[Math.min(categories.length - 1, categoryIndex + 1)]!.id,
      rowIndex: 0,
      zone: "nav",
    };
  if (UP_KEYS.has(name))
    return { categoryId: categories[Math.max(0, categoryIndex - 1)]!.id, rowIndex: 0, zone: "nav" };
  if (ENTER_BODY_KEYS.has(name))
    return { categoryId: categories[categoryIndex]!.id, rowIndex: 0, zone: "body" };
  return null;
}

function moveBodyRow(name: string, nav: SettingsNav, rowCount: number): SettingsNav | null {
  if (DOWN_KEYS.has(name)) return { ...nav, rowIndex: Math.min(rowCount - 1, nav.rowIndex + 1) };
  if (UP_KEYS.has(name)) return { ...nav, rowIndex: Math.max(0, nav.rowIndex - 1) };
  if (name === "h" || name === "tab") return { ...nav, zone: "nav" };
  return null;
}

export function useSettingsDialog(params: {
  theme: Theme;
  appearance: Appearance;
  autoClose: AutoClose;
  setAutoClose: Dispatch<SetStateAction<AutoClose>>;
  reviewMode: ReviewPanelMode;
  setReviewMode: Dispatch<SetStateAction<ReviewPanelMode>>;
  themeName: ThemeName;
  setThemeName: Dispatch<SetStateAction<ThemeName>>;
  themeOverrides: Partial<Theme>;
  setTheme: Dispatch<SetStateAction<Theme>>;
  quickActions: QuickAction[];
  setQuickActions: Dispatch<SetStateAction<QuickAction[]>>;
  controller: ReviewController;
  setMenuDialog: Dispatch<SetStateAction<"keybinds" | "settings" | null>>;
}): SettingsDialogModel {
  const {
    theme,
    appearance,
    autoClose,
    setAutoClose,
    reviewMode,
    setReviewMode,
    themeName,
    setThemeName,
    themeOverrides,
    setTheme,
    quickActions,
    setQuickActions,
    controller,
    setMenuDialog,
  } = params;

  const [settingsNav, setSettingsNav] = useState<SettingsNav>({
    categoryId: "general",
    rowIndex: 0,
    zone: "body",
  });
  const [actionsExpandedIndex, setActionsExpandedIndex] = useState<number | null>(null);

  const commitActions = (next: QuickAction[]): void => {
    setQuickActions(next);
    persistActions(next);
  };
  const editActionMetadata = (index: number, metadata: string): void =>
    commitActions(
      quickActions.map((action, actionIndex) =>
        actionIndex === index
          ? { ...action, metadata: metadata.trim() ? metadata : undefined }
          : action,
      ),
    );
  const resetActions = (): void => {
    setActionsExpandedIndex(null);
    commitActions(DEFAULT_QUICK_ACTIONS.map((action) => ({ ...action })));
  };
  const addAction = (): void => {
    setSettingsNav((state) => ({ ...state, zone: "body", rowIndex: quickActions.length }));
    commitActions([...quickActions, { prompt: "New action" }]);
  };

  const settingsCategories: SettingsCategory[] = [
    {
      id: "general",
      name: "General",
      description: "submission behaviour",
      rows: [
        {
          key: "autoClose",
          label: "Auto-close on submit",
          kind: "cycle",
          options: ["off", "3s", "10s"],
        },
      ],
    },
    {
      id: "display",
      name: "Display",
      description: "the review panel",
      rows: [
        {
          key: "reviewPanel",
          label: "Review panel",
          kind: "cycle",
          options: ["expanded", "compact", "hidden"],
        },
      ],
    },
    {
      id: "appearance",
      name: "Appearance",
      description: "the color theme",
      rows: [
        {
          key: "theme",
          label: "Theme",
          kind: "cycle",
          options: THEME_NAMES.map((name) => THEME_LABELS[name]),
        },
      ],
    },
    {
      id: "actions",
      name: "Actions",
      description: "quick-action comments",
      rows: [],
      customBody: (
        <QuickActionsEditor
          actions={quickActions}
          selectedIndex={settingsNav.categoryId === "actions" ? settingsNav.rowIndex : -1}
          expandedIndex={actionsExpandedIndex}
          onToggleExpand={(index) => {
            setSettingsNav((state) => ({ ...state, zone: "body", rowIndex: index }));
            setActionsExpandedIndex((current) => (current === index ? null : index));
          }}
          onEditMetadata={editActionMetadata}
          onReset={resetActions}
          onAdd={addAction}
          theme={theme}
        />
      ),
    },
  ];
  const settingsValues = {
    autoClose: autoClose === "off" ? "off" : `${autoClose}s`,
    reviewPanel: reviewMode,
    theme: THEME_LABELS[themeName],
  };
  const cycleSetting = (rowKey: string): void => {
    if (rowKey === "autoClose") {
      const next: AutoClose = autoClose === "off" ? 3 : autoClose === 3 ? 10 : "off";
      setAutoClose(next);
      persistAutoClose(next);
    } else if (rowKey === "reviewPanel") {
      const order: ReviewPanelMode[] = ["expanded", "compact", "hidden"];
      const next = order[(order.indexOf(reviewMode) + 1) % order.length]!;
      setReviewMode(next);
      controller.saveReviewPanel({ mode: next });
    } else if (rowKey === "theme") {
      const next = THEME_NAMES[(THEME_NAMES.indexOf(themeName) + 1) % THEME_NAMES.length]!;
      setThemeName(next);
      setTheme(composeTheme(next, themeOverrides, appearance));
      persistTheme(next);
    }
  };

  const onCategorySelect = (categoryId: string): void => {
    setActionsExpandedIndex(null);
    setSettingsNav({ categoryId, rowIndex: 0, zone: "body" });
  };

  const handleSettingsKey = (name: string): void => {
    // an open system-prompt input owns typing; only esc (close it) escapes here
    if (actionsExpandedIndex !== null) {
      if (name === "escape") setActionsExpandedIndex(null);
      return;
    }
    if (name === "escape") return void setMenuDialog(null);
    const categoryIndex = settingsCategories.findIndex(
      (category) => category.id === settingsNav.categoryId,
    );
    const category = settingsCategories[categoryIndex]!;
    if (settingsNav.zone === "nav") {
      const next = moveNavZone(name, categoryIndex, settingsCategories);
      if (next) setSettingsNav(next);
      return;
    }
    // the Actions category is a list of quick actions plus a trailing "add" row
    if (category.id === "actions") {
      const moved = moveBodyRow(name, settingsNav, quickActions.length + 1);
      if (moved) return void setSettingsNav(moved);
      if (ACTIVATE_KEYS.has(name)) {
        if (settingsNav.rowIndex === quickActions.length) addAction();
        else setActionsExpandedIndex(settingsNav.rowIndex);
      }
      return;
    }
    const moved = moveBodyRow(name, settingsNav, category.rows.length);
    if (moved) return void setSettingsNav(moved);
    if (name === "return" || name === "space")
      cycleSetting(category.rows[settingsNav.rowIndex]!.key);
  };

  return {
    settingsNav,
    actionsExpandedIndex,
    setActionsExpandedIndex,
    settingsCategories,
    settingsValues,
    cycleSetting,
    handleSettingsKey,
    onCategorySelect,
  };
}
