import React from "react";
import type { DiffFileContents } from "@cueloop/schema";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ChangesColumn } from "./ChangesColumn";

export const meta: StoryMeta = { title: "Surfaces/ChangesColumn" };

function Frame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ width: "100%", height: "100%", flexDirection: "row" }}>{children}</box>;
}

const files: DiffFileContents[] = [
  { path: "packages/client/src/App.tsx", oldContents: "a", newContents: "b", status: "modified" },
  {
    path: "packages/client/src/components/ChangesColumn.tsx",
    oldContents: "",
    newContents: "c",
    status: "added",
  },
  { path: "packages/daemon/src/review.ts", oldContents: "d", newContents: "", status: "deleted" },
  { path: "README.md", oldContents: "e", newContents: "f", status: "modified" },
];

export const Changed: Story = {
  render: () => (
    <Frame>
      <ChangesColumn
        open
        files={files}
        selectedPath="packages/client/src/App.tsx"
        onSelectFile={() => {}}
        theme={DARK}
      />
    </Frame>
  ),
  expectedColors: [DARK.accent, DARK.border],
  size: { width: 60, height: 12 },
};
