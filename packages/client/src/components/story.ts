/**
 * The story contract. Every component file in components/ ships a
 * colocated *.stories.tsx that exports `meta` plus named Story objects.
 * The catalog IS the regression suite: stories.test.tsx walks every story,
 * snapshots its char frame, and asserts declared colors against the styled
 * spans; the `bun run stories` TUI renders the same objects interactively.
 */

import type React from "react";
import type { TreeNode } from "./primitives/tree-model";

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
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function"
  );
}

function isStoryMeta(value: unknown): value is StoryMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    typeof value.title === "string"
  );
}

/** Import every *.stories.tsx next to the components and flatten the exports. */
export async function loadStories(): Promise<LoadedStory[]> {
  const glob = new Bun.Glob("**/*.stories.tsx");
  const files = [...glob.scanSync({ cwd: import.meta.dir })].sort();
  const loaded: LoadedStory[] = [];

  for (const file of files) {
    const moduleExports = await import(`${import.meta.dir}/${file}`);
    const meta = moduleExports["meta"];
    const moduleTitle = isStoryMeta(meta) ? meta.title : file.replace(/\.stories\.tsx$/, "");

    for (const [exportName, exported] of Object.entries(moduleExports)) {
      if (exportName === "meta" || !isStory(exported)) continue;
      loaded.push({ moduleTitle, storyName: exportName, story: exported });
    }
  }

  return loaded;
}

/** A folder node keeps its children array live so the builder can append to it. */
interface StoryTreeFolder extends TreeNode {
  children: TreeNode[];
}

// A component folder holding one story of its own name reads as one row, not a folder wrapping a single leaf.
function hoistSingleStoryFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.children === undefined) return node;
    const children = hoistSingleStoryFolders(node.children);
    const onlyChild = children.length === 1 ? children[0] : undefined;
    if (
      onlyChild !== undefined &&
      onlyChild.children === undefined &&
      onlyChild.label === node.label
    ) {
      return onlyChild;
    }

    return { ...node, children };
  });
}

/**
 * Nest the flat catalog into folder/component groups by splitting each
 * moduleTitle on "/". Each story becomes a leaf keyed `${moduleTitle}/${storyName}`
 * under its component node; a component holding a single story of its own name
 * collapses so its row IS that story leaf.
 */
export function buildStoryTree(stories: LoadedStory[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const foldersByPath = new Map<string, StoryTreeFolder>();

  for (const { moduleTitle, storyName } of stories) {
    let siblings = roots;
    let path = "";

    for (const segment of moduleTitle.split("/")) {
      path = path === "" ? segment : `${path}/${segment}`;
      let folder = foldersByPath.get(path);
      if (folder === undefined) {
        folder = { id: path, label: segment, children: [] };
        foldersByPath.set(path, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }

    siblings.push({ id: `${moduleTitle}/${storyName}`, label: storyName });
  }

  return hoistSingleStoryFolders(roots);
}

/** Component files that must carry stories: every .tsx that is not a story/test/prototype. */
export function componentFilesMissingStories(): string[] {
  const componentGlob = new Bun.Glob("**/*.tsx");
  const files = [...componentGlob.scanSync({ cwd: import.meta.dir })];
  const missing: string[] = [];

  for (const file of files) {
    if (file.endsWith(".stories.tsx") || file.endsWith(".test.tsx")) continue;
    if (file.endsWith(".prototype.tsx")) continue;
    if (file === "stories-app.tsx") continue;
    const storiesSibling = file.replace(/\.tsx$/, ".stories.tsx");

    if (!files.includes(storiesSibling)) missing.push(file);
  }

  return missing;
}
