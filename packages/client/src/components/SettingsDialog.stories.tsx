import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { SettingsDialog, type SettingsCategory } from "./SettingsDialog";

export const meta: StoryMeta = { title: "SettingsDialog" };

const CATEGORIES: SettingsCategory[] = [
  {
    id: "general",
    name: "General",
    description: "identity and submission",
    rows: [
      { key: "displayName", label: "Display name", kind: "text" },
      { key: "autoClose", label: "Auto-close on submit", kind: "cycle", options: ["off", "3s", "on"] },
    ],
  },
  {
    id: "display",
    name: "Display",
    description: "plan width and chrome",
    rows: [
      { key: "planWidth", label: "Plan width", kind: "cycle", options: ["default", "wide", "full"] },
      { key: "showLineNumbers", label: "Line numbers", kind: "toggle" },
    ],
  },
];

const VALUES = { displayName: "amber-heron", autoClose: "3s", planWidth: "default", showLineNumbers: true };

export const NavZone: Story = {
  render: () => (
    <SettingsDialog
      isOpen
      categories={CATEGORIES}
      values={VALUES}
      activeCategoryId="general"
      activeRowIndex={0}
      activeZone="nav"
      onCategorySelect={() => {}}
      onRowActivate={() => {}}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 100, height: 30 },
};

export const BodyZone: Story = {
  render: () => (
    <SettingsDialog
      isOpen
      categories={CATEGORIES}
      values={VALUES}
      activeCategoryId="display"
      activeRowIndex={1}
      activeZone="body"
      onCategorySelect={() => {}}
      onRowActivate={() => {}}
    />
  ),
  expectedColors: [DARK.green],
  size: { width: 100, height: 30 },
};
