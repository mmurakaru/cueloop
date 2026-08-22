/**
 * The story contract. Every component file in components/ ships a
 * colocated *.stories.tsx that exports `meta` plus named Story objects.
 * The catalog IS the regression suite: stories.test.tsx walks every story,
 * snapshots its char frame, and asserts declared colors against the styled
 * spans; the `bun run stories` TUI renders the same objects interactively.
 */

import type React from "react";

export interface StoryMeta {
  /** Catalog path, e.g. "primitives/Card". */
  title: string;
}

export interface Story {
  render: () => React.ReactNode;
  /**
   * Colors (hex tokens) that must appear among the rendered frame's styled
   * spans - the color regression net for color-bearing stories.
   */
  expectedColors?: string[];
  /** Virtual terminal size; defaults to 80x24. */
  size?: { width: number; height: number };
}

export interface LoadedStory {
  moduleTitle: string;
  storyName: string;
  story: Story;
}

export function isStory(value: unknown): value is Story {
  return (
    typeof value === "object" && value !== null && typeof (value as Story).render === "function"
  );
}

/** Import every *.stories.tsx next to the components and flatten the exports. */
export async function loadStories(): Promise<LoadedStory[]> {
  const glob = new Bun.Glob("**/*.stories.tsx");
  const files = [...glob.scanSync({ cwd: import.meta.dir })].sort();
  const loaded: LoadedStory[] = [];
  for (const file of files) {
    const moduleExports = (await import(`${import.meta.dir}/${file}`)) as Record<string, unknown>;
    const meta = moduleExports["meta"] as StoryMeta | undefined;
    const moduleTitle = meta?.title ?? file.replace(/\.stories\.tsx$/, "");
    for (const [exportName, exported] of Object.entries(moduleExports)) {
      if (exportName === "meta" || !isStory(exported)) continue;
      loaded.push({ moduleTitle, storyName: exportName, story: exported });
    }
  }
  return loaded;
}

/** Component files that must carry stories: every .tsx that is not a story/test/prototype. */
export function componentFilesMissingStories(): string[] {
  const componentGlob = new Bun.Glob("**/*.tsx");
  const files = [...componentGlob.scanSync({ cwd: import.meta.dir })];
  const missing: string[] = [];
  for (const file of files) {
    if (file.endsWith(".stories.tsx") || file.endsWith(".test.tsx")) continue;
    // *.prototype.tsx are throwaway design spikes, exempt from the catalog.
    if (file.endsWith(".prototype.tsx")) continue;
    if (file === "stories-app.tsx") continue;
    const storiesSibling = file.replace(/\.tsx$/, ".stories.tsx");
    if (!files.includes(storiesSibling)) missing.push(file);
  }
  return missing;
}
