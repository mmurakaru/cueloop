import React from "react";
import { SCHEMA_VERSION, type Thread } from "@cueloop/schema";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AnnotatableFileView } from "./AnnotatableFileView";

export const meta: StoryMeta = { title: "Surfaces/AnnotatableFileView" };

const SAMPLE = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

const SESSION: Thread = {
  schemaVersion: SCHEMA_VERSION,
  id: "ses_story",
  workspace: { repoRoot: "/repo", branch: "main" },
  artifact: { type: "plan", content: "# Plan\n", meta: {} },
  revisions: [{ revision: 1, content: "# Plan\n", submittedAt: "2026-01-01T00:00:00Z" }],
  annotations: [],
  verdict: null,
  status: "pending",
  createdAt: "2026-01-01T00:00:00Z",
};

const noop = (): void => {};

export const Loaded: Story = {
  render: () => (
    <AnnotatableFileView
      path="src/add.ts"
      loadContents={() => Promise.resolve(SAMPLE)}
      session={SESSION}
      quickActions={[]}
      observer={false}
      onAddComment={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 60, height: 12 },
};
