import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { PaneGrid } from "../PaneGrid";
import { Tree } from "../primitives/Tree";
import type { TreeNode } from "../primitives/tree-model";

export const meta: StoryMeta = { title: "Pages/Workspace" };

const NAVIGATION: TreeNode[] = [
  {
    id: "projects",
    label: "Projects",
    children: [
      {
        id: "cueloop",
        label: "cueloop",
        children: [
          { id: "cueloop/review", label: "Review the app shell" },
          { id: "cueloop/read", label: "Read Cueloop Repository" },
        ],
      },
    ],
  },
  {
    id: "threads",
    label: "Threads",
    children: [{ id: "threads/welcome", label: "Welcome to cueloop" }],
  },
];

const CHANGED_FILES: TreeNode[] = [
  {
    id: "packages",
    label: "packages",
    children: [
      {
        id: "client",
        label: "client",
        children: [
          { id: "client/AppShell.tsx", label: "AppShell.tsx", status: "modified" },
          { id: "client/Workspace.stories.tsx", label: "Workspace.stories.tsx", status: "added" },
        ],
      },
    ],
  },
  { id: "README.md", label: "README.md", status: "modified" },
];

interface CodeSampleLine {
  number: number;
  code: string;
}

const CODE_SAMPLE: readonly CodeSampleLine[] = [
  { number: 17, code: "export function AppShell({" },
  { number: 18, code: "  header," },
  { number: 19, code: "  sidebar," },
  { number: 20, code: "  main," },
  { number: 21, code: "  inspector," },
  { number: 22, code: "}: AppShellProps) {" },
  { number: 23, code: "  const tokens = theme ?? DARK;" },
  { number: 24, code: "  return <box>{main}</box>;" },
];

function Sidebar(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingTop: 1 }}>
      <Tree
        nodes={NAVIGATION}
        expandedIds={new Set(["projects", "cueloop", "threads"])}
        selectedId="cueloop/review"
      />
    </box>
  );
}

function TranscriptLine({ children }: { children: React.ReactNode }): React.ReactNode {
  return <text fg={DARK.textMuted}>{children}</text>;
}

function CommentRow(): React.ReactNode {
  return (
    <box
      style={{
        border: ["left"],
        borderStyle: "single",
        borderColor: DARK.accent,
        flexDirection: "column",
        paddingLeft: 1,
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <text fg={DARK.textDim}>markus commented on AppShell.tsx</text>
      <text fg={DARK.text}>The single rules read cleaner than an enclosing frame here.</text>
    </box>
  );
}

function Main(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.text}>Review the app shell</text>
      <text> </text>
      <TranscriptLine>
        The three-pane layout divides regions with straight rules only.
      </TranscriptLine>
      <TranscriptLine>
        Sidebar navigates, the transcript reads, the inspector shows code.
      </TranscriptLine>
      <CommentRow />
      <TranscriptLine>Header and footer are thin label rows the shell rules itself.</TranscriptLine>
    </box>
  );
}

function CodePane(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={DARK.textMuted}>AppShell.tsx</text>
      <text> </text>
      {CODE_SAMPLE.map((line) => (
        <box key={line.number} style={{ flexDirection: "row" }}>
          <text fg={DARK.textDim}>{String(line.number).padStart(3, " ")} </text>
          <text fg={DARK.text}>{line.code}</text>
        </box>
      ))}
    </box>
  );
}

function Inspector(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <CodePane />
      <text> </text>
      <text fg={DARK.textDim}>Changed files</text>
      <Tree
        nodes={CHANGED_FILES}
        expandedIds={new Set(["packages", "client"])}
        selectedId="client/AppShell.tsx"
        showStatus
      />
    </box>
  );
}

function Header(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", paddingLeft: 1 }}>
      <text fg={DARK.textMuted}>Review the app shell</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={DARK.textDim}>cueloop / main</text>
    </box>
  );
}

function Footer(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", paddingLeft: 1 }}>
      <text fg={DARK.textDim}>2 files changed</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={DARK.textDim}>Fable 5</text>
    </box>
  );
}

export const ThreePane: Story = {
  render: () => (
    <PaneGrid
      sidebar={<Sidebar />}
      main={<Main />}
      mainHeader={<Header />}
      inspector={<Inspector />}
      footer={<Footer />}
    />
  ),
  expectedColors: [DARK.border, DARK.accent],
  size: { width: 160, height: 42 },
};
