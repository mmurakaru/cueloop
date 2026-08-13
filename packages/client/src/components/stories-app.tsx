/**
 * The interactive stories catalog (`bun run stories`): a left list of
 * component modules (j/k), h/l cycling through the module's stories, and the
 * selected story rendered live in the preview pane. The same story objects
 * back the snapshot harness - what this TUI shows is what the tests assert.
 */

import React, { useMemo, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK } from "../theme";
import { ThemeProvider } from "./theme-context";
import { loadStories, type LoadedStory } from "./story";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

function StoriesApp({ stories, onExit }: { stories: LoadedStory[]; onExit: () => void }): React.ReactNode {
  const moduleTitles = useMemo(() => [...new Set(stories.map((story) => story.moduleTitle))], [stories]);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [storyIndex, setStoryIndex] = useState(0);
  const moduleTitle = moduleTitles[moduleIndex]!;
  const moduleStories = stories.filter((story) => story.moduleTitle === moduleTitle);
  const current = moduleStories[Math.min(storyIndex, moduleStories.length - 1)]!;

  useKeyboard((key) => {
    if (key.name === "q") onExit();
    else if (key.name === "j" || key.name === "down") {
      setModuleIndex((index) => Math.min(moduleTitles.length - 1, index + 1));
      setStoryIndex(0);
    } else if (key.name === "k" || key.name === "up") {
      setModuleIndex((index) => Math.max(0, index - 1));
      setStoryIndex(0);
    } else if (key.name === "l" || key.name === "right") {
      setStoryIndex((index) => (index + 1) % moduleStories.length);
    } else if (key.name === "h" || key.name === "left") {
      setStoryIndex((index) => (index - 1 + moduleStories.length) % moduleStories.length);
    }
  });

  return (
    <ThemeProvider theme={DARK}>
      <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: DARK.bg }}>
        <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
          <text fg={DARK.text}>
            <span fg={DARK.accent}>cueloop stories</span>
            <span fg={DARK.textDim}>
              {" "}· {moduleTitle} / {current.storyName}
            </span>
          </text>
        </box>
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          <box style={{ width: 28, backgroundColor: DARK.panel, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
            {moduleTitles.map((title, index) => (
              <text key={title} fg={index === moduleIndex ? DARK.accent : DARK.textMuted}>
                {index === moduleIndex ? "▸ " : "  "}
                {title}
              </text>
            ))}
          </box>
          <box
            style={{
              flexGrow: 1,
              flexDirection: "column",
              border: true,
              borderStyle: FRAME_BORDER_STYLE,
              borderColor: DARK.border,
            }}
            title={` ${current.storyName} (${moduleStories.indexOf(current) + 1}/${moduleStories.length}) `}
          >
            {/* remount per story so component-local state never leaks across */}
            <box key={`${moduleTitle}/${current.storyName}`} style={{ flexGrow: 1, flexDirection: "column" }}>
              {current.story.render()}
            </box>
          </box>
        </box>
        <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
          <text fg={DARK.textDim}>j/k component · h/l story · q quit</text>
        </box>
      </box>
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
