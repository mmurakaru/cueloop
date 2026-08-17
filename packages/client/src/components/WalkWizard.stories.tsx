import React from "react";
import { DARK } from "../theme";
import type { WalkFile } from "../walk";
import type { Story, StoryMeta } from "./story";
import { WalkWizard } from "./WalkWizard";

export const meta: StoryMeta = { title: "WalkWizard" };

const FILES: WalkFile[] = [
  {
    path: "packages/daemon/src/store.ts",
    added: 12,
    removed: 3,
    preview: [
      { sign: "+", text: "const viewed = new Set<string>();" },
      { sign: "+", text: "record.viewedPaths = [...viewed];" },
      { sign: "-", text: "// viewed tracking lives in the client only" },
    ],
  },
  {
    path: "packages/client/src/walk.ts",
    added: 48,
    removed: 0,
    preview: [{ sign: "+", text: "export function firstUnviewedIndex(files, viewed) {" }],
  },
  { path: "packages/schema/src/types.ts", added: 3, removed: 0, preview: [{ sign: "+", text: "viewedPaths?: string[];" }] },
];

const noop = (): void => {};

export const FirstFile: Story = {
  render: () => (
    <WalkWizard
      files={FILES}
      index={0}
      viewedPaths={new Set()}
      terminalWidth={80}
      onSubmitRequest={noop}
      onBack={noop}
    />
  ),
  // the main card wears the accent border; stats carry the +/- colors
  expectedColors: [DARK.accent, DARK.green, DARK.red, DARK.insertedForeground, DARK.deletedForeground],
};

export const WithAgentNote: Story = {
  render: () => (
    <WalkWizard
      files={FILES}
      index={1}
      viewedPaths={new Set(["packages/daemon/src/store.ts"])}
      note="New module: pure helpers that pick the next unviewed file. No IO, unit tested."
      terminalWidth={80}
      onSubmitRequest={noop}
      onBack={noop}
    />
  ),
  // the agent-note block wears the plain gray border token, not the accent
  expectedColors: [DARK.accent, DARK.border, DARK.textMuted],
};

export const EndCard: Story = {
  render: () => (
    <WalkWizard
      files={FILES}
      index={3}
      viewedPaths={new Set(FILES.map((file) => file.path))}
      terminalWidth={80}
      onSubmitRequest={noop}
      onBack={noop}
    />
  ),
  // the end card wears the green border and the solid submit button
  expectedColors: [DARK.green, DARK.accent, DARK.accentInk],
};

export const EndCardPartialPass: Story = {
  render: () => (
    <WalkWizard
      files={FILES}
      index={3}
      viewedPaths={new Set(["packages/daemon/src/store.ts"])}
      terminalWidth={80}
      onSubmitRequest={noop}
      onBack={noop}
    />
  ),
  expectedColors: [DARK.green],
};
