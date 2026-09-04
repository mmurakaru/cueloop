/**
 * The interactive stories catalog (`bun run stories`): a nested tree of
 * component modules on the left (j/k to move, h/l to fold or open) and the
 * selected story rendered live in the preview pane. The same story objects
 * back the snapshot harness - what this TUI shows is what the tests assert.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK } from "../theme";
import { ThemeProvider } from "./theme-context";
import { buildStoryTree, loadStories, type LoadedStory } from "./story";
import { AppShell } from "./AppShell";
import { ShellHeader } from "./ShellHeader";
import { Tree } from "./primitives/Tree";
import { NERD } from "./primitives/icons";
import { allFolderIds, flattenTree } from "./primitives/tree-model";

interface StoriesAppProps {
  stories: LoadedStory[];
  onExit: () => void;
}

function StoriesApp({ stories, onExit }: StoriesAppProps): React.ReactNode {
  const treeNodes = useMemo(() => buildStoryTree(stories), [stories]);
  const storiesById = useMemo(
    () => new Map(stories.map((story) => [`${story.moduleTitle}/${story.storyName}`, story])),
    [stories],
  );
  const firstStoryId = `${stories[0]!.moduleTitle}/${stories[0]!.storyName}`;

  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() =>
    allFolderIds(treeNodes),
  );
  const [selectedId, setSelectedId] = useState(firstStoryId);
  const [openedId, setOpenedId] = useState(firstStoryId);

  const rows = flattenTree(treeNodes, { expandedIds });
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0];
  const opened = storiesById.get(openedId);
  const sidebarScroll = useRef<ScrollBoxRenderable | null>(null);

  // keep the moving selection inside the scrolled viewport
  useEffect(() => {
    try {
      sidebarScroll.current?.scrollChildIntoView(`tree-row-${selectedId}`);
    } catch {
      // reveal is best-effort; the selection state is already correct
    }
  }, [selectedId]);

  const openStory = (id: string): void => {
    if (storiesById.has(id)) setOpenedId(id);
  };

  const toggleFolder = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const expandFolder = (id: string): void => {
    setExpandedIds((current) => new Set(current).add(id));
  };

  const collapseFolder = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(id);

      return next;
    });
  };

  const moveSelection = (delta: number): void => {
    const index = rows.findIndex((row) => row.id === selectedId);
    const nextIndex = Math.max(0, Math.min(rows.length - 1, index + delta));
    const nextRow = rows[nextIndex];
    if (nextRow !== undefined) setSelectedId(nextRow.id);
  };

  useKeyboard((key) => {
    if (key.name === "q") onExit();
    else if (key.name === "j" || key.name === "down") moveSelection(1);
    else if (key.name === "k" || key.name === "up") moveSelection(-1);
    else if (selectedRow === undefined) return;
    else if (key.name === "l" || key.name === "right") {
      if (selectedRow.isFolder) expandFolder(selectedRow.id);
      else openStory(selectedRow.id);
    } else if (key.name === "h" || key.name === "left") {
      if (selectedRow.isFolder) collapseFolder(selectedRow.id);
    } else if (key.name === "return" || key.name === "space") {
      if (selectedRow.isFolder) toggleFolder(selectedRow.id);
      else openStory(selectedRow.id);
    }
  });

  return (
    <ThemeProvider theme={DARK}>
      <AppShell
        theme={DARK}
        header={
          <ShellHeader
            theme={DARK}
            leftIcons={[NERD.settings, NERD.sidebar]}
            leftLabel="cueloop stories"
            title={opened !== undefined ? `${opened.moduleTitle} / ${opened.storyName}` : "cueloop"}
            rightIcons={[NERD.search, NERD.expand, NERD.sidebar]}
          />
        }
        sidebar={
          <box style={{ flexDirection: "column", flexGrow: 1, paddingTop: 1 }}>
            <scrollbox ref={sidebarScroll} style={{ flexGrow: 1 }} focused={false}>
              <Tree
                nodes={treeNodes}
                expandedIds={expandedIds}
                selectedId={selectedId}
                theme={DARK}
                onSelect={(id) => {
                  setSelectedId(id);
                  openStory(id);
                }}
                onToggle={(id) => {
                  setSelectedId(id);
                  toggleFolder(id);
                }}
              />
            </scrollbox>
          </box>
        }
        main={
          opened !== undefined ? (
            <scrollbox style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }} focused={false}>
              {/* remount per story so component-local state never leaks across */}
              <box key={openedId} style={{ flexDirection: "column" }}>
                {opened.story.render()}
              </box>
            </scrollbox>
          ) : (
            <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
              <text fg={DARK.textDim}>Select a story</text>
            </box>
          )
        }
        footer={
          <box style={{ height: 1, paddingLeft: 1 }}>
            <text fg={DARK.textDim}>j/k move · h/l fold or open · enter open · q quit</text>
          </box>
        }
      />
    </ThemeProvider>
  );
}

if (import.meta.main) {
  const stories = await loadStories();
  const renderer = await createCliRenderer();

  createRoot(renderer).render(
    <StoriesApp
      stories={stories}
      onExit={() => {
        renderer.destroy();
        queueMicrotask(() => process.exit(0));
      }}
    />,
  );
}
