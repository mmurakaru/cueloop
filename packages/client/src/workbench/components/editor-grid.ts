// The Changes pane's editor layout: a tree of nodes where a leaf is an editor group (a tab strip plus
// its one active tab) and a branch splits child nodes along an orientation. Splitting a file tab
// moves it into a new group; a group is pruned when its last tab closes, collapsing the
// branch that held it.

/** One editor in a group's tab strip: the Changes tab (the whole diff), a per-file tab, or Welcome. */
export interface EditorTab {
  id: string;
  kind: "changes" | "file" | "welcome";
  label: string;
  /** Repo-relative path for a file tab; absent for the Changes and Welcome tabs. */
  path?: string;
  /** A file tab shows either a single-file diff or the file's plain contents. */
  fileView?: "diff" | "contents";
  /** A preview is replaced by the next file opened in its group. */
  preview?: boolean;
}

/** A leaf of the grid: one editor group holding tabs, with the active tab id. */
export interface EditorGroup {
  type: "group";
  id: string;
  tabs: EditorTab[];
  activeTabId: string | null;
}

/** A branch of the grid: children laid out along one orientation (horizontal = side by side). */
export interface EditorBranch {
  type: "branch";
  id: string;
  orientation: "horizontal" | "vertical";
  children: EditorNode[];
}

export type EditorNode = EditorGroup | EditorBranch;

/** Which edge a split places the new group on; Left/Right split horizontally, Up/Down vertically. */
export type SplitDirection = "left" | "right" | "up" | "down";

/** The editor grid stops at eight groups so every tile remains usable. */
export const MAX_EDITOR_GROUPS = 8;

/** A split's outcome: the new grid and the id of the group that should take focus. */
export interface SplitResult {
  tree: EditorNode;
  focusGroupId: string;
}

const freshId = (): string => crypto.randomUUID();

/** A new editor group holding the given tabs, with the first tab active. */
export function makeGroup(tabs: EditorTab[]): EditorGroup {
  return { type: "group", id: freshId(), tabs, activeTabId: tabs[0]?.id ?? null };
}

/** The Changes tab: the whole diff in one scroll, the disposable default of the Changes pane. */
export function changesTab(): EditorTab {
  return { id: freshId(), kind: "changes", label: "Changes" };
}

/** The Welcome tab: the getting-started surface, a disposable tab shown before any thread is opened. */
export function welcomeTab(): EditorTab {
  return { id: freshId(), kind: "welcome", label: "Welcome" };
}

/** A file tab, opened from a tree; a diff view for a changed file, plain contents otherwise. */
export function fileTab(
  label: string,
  path: string,
  fileView: "diff" | "contents",
  preview = false,
): EditorTab {
  return { id: freshId(), kind: "file", label, path, fileView, preview };
}

/** The id of the first editor group in reading order; the fallback focus target. */
export function firstGroupId(node: EditorNode): string {
  return node.type === "group" ? node.id : firstGroupId(node.children[0]!);
}

/** Whether a group id still exists in the grid; used to re-home focus after a prune. */
export function containsGroup(node: EditorNode, groupId: string): boolean {
  if (node.type === "group") return node.id === groupId;

  return node.children.some((child) => containsGroup(child, groupId));
}

/** Count editor tiles, including groups inside nested horizontal and vertical splits. */
export function countEditorGroups(node: EditorNode): number {
  if (node.type === "group") return 1;

  return node.children.reduce((count, child) => count + countEditorGroups(child), 0);
}

function replaceGroup(
  node: EditorNode,
  id: string,
  fn: (group: EditorGroup) => EditorNode,
): EditorNode {
  if (node.type === "group") return node.id === id ? fn(node) : node;

  return { ...node, children: node.children.map((child) => replaceGroup(child, id, fn)) };
}

/** Make a tab the active one in its group. */
export function activateTab(node: EditorNode, groupId: string, tabId: string): EditorNode {
  return replaceGroup(node, groupId, (group) => ({ ...group, activeTabId: tabId }));
}

/** Append a tab to a group and focus it. */
export function addTab(node: EditorNode, groupId: string, tab: EditorTab): EditorNode {
  return replaceGroup(node, groupId, (group) => ({
    ...group,
    tabs: [...group.tabs, tab],
    activeTabId: tab.id,
  }));
}

/** Activate the one Changes tab, or add it beside the active group's existing tabs. */
export function openChangesTab(node: EditorNode, groupId: string): SplitResult {
  const existing = findTabByKind(node, "changes");

  if (existing) {
    return {
      tree: activateTab(node, existing.groupId, existing.tab.id),
      focusGroupId: existing.groupId,
    };
  }

  return { tree: addTab(node, groupId, changesTab()), focusGroupId: groupId };
}

function findTabByKind(
  node: EditorNode,
  kind: EditorTab["kind"],
): { groupId: string; tab: EditorTab } | null {
  if (node.type === "group") {
    const tab = node.tabs.find((candidate) => candidate.kind === kind);

    return tab ? { groupId: node.id, tab } : null;
  }

  for (const child of node.children) {
    const found = findTabByKind(child, kind);

    if (found) return found;
  }

  return null;
}

interface FileTabLocation {
  groupId: string;
  tab: EditorTab;
}

/** A file path is one editor tab across the grid, even when the groups are split. */
function findFileTab(node: EditorNode, path: string): FileTabLocation | null {
  if (node.type === "group") {
    const tab = node.tabs.find((candidate) => candidate.kind === "file" && candidate.path === path);

    return tab ? { groupId: node.id, tab } : null;
  }

  for (const child of node.children) {
    const found = findFileTab(child, path);

    if (found) return found;
  }

  return null;
}

/** Open a file once, replacing only a preview; reopening focuses its existing tab. */
export function openFileTab(
  node: EditorNode,
  groupId: string,
  path: string,
  fileView: "diff" | "contents",
  persistent: boolean,
): SplitResult {
  const existing = findFileTab(node, path);

  if (existing) {
    return {
      tree: replaceGroup(node, existing.groupId, (group) => ({
        ...group,
        tabs: group.tabs.map((tab) =>
          tab.id === existing.tab.id
            ? { ...tab, fileView, preview: persistent ? false : tab.preview }
            : tab,
        ),
        activeTabId: existing.tab.id,
      })),
      focusGroupId: existing.groupId,
    };
  }

  const label = path.split("/").pop() ?? path;
  const tab = fileTab(label, path, fileView, !persistent);

  return {
    tree: replaceGroup(node, groupId, (group) => {
      const previewIndex = persistent ? -1 : group.tabs.findIndex((item) => item.preview);
      const tabs = [...group.tabs];

      if (previewIndex >= 0) tabs.splice(previewIndex, 1, tab);
      else tabs.push(tab);

      return { ...group, tabs, activeTabId: tab.id };
    }),
    focusGroupId: groupId,
  };
}

/** Keep a preview file tab open when its tab is double-clicked. */
export function keepFileTab(node: EditorNode, groupId: string, tabId: string): EditorNode {
  return replaceGroup(node, groupId, (group) => ({
    ...group,
    tabs: group.tabs.map((tab) => (tab.id === tabId ? { ...tab, preview: false } : tab)),
  }));
}

/** Drop empty groups and collapse a branch that ends up with one child; null when nothing remains. */
export function pruneEmpty(node: EditorNode): EditorNode | null {
  if (node.type === "group") return node.tabs.length > 0 ? node : null;
  const kept = node.children.map(pruneEmpty).filter((child): child is EditorNode => child !== null);

  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;

  return { ...node, children: kept };
}

/** Close a tab; returns the pruned tree, or null when the last tab of the whole grid is closed. */
export function closeTab(node: EditorNode, groupId: string, tabId: string): EditorNode | null {
  const next = replaceGroup(node, groupId, (group) => {
    const tabs = group.tabs.filter((tab) => tab.id !== tabId);
    const activeTabId = group.activeTabId === tabId ? (tabs[0]?.id ?? null) : group.activeTabId;

    return { ...group, tabs, activeTabId };
  });

  return pruneEmpty(next);
}

/** Split a group's active tab into a new group on the given edge; returns the tree and the new focus. */
export function splitGroup(
  node: EditorNode,
  groupId: string,
  direction: SplitDirection,
): SplitResult {
  if (countEditorGroups(node) >= MAX_EDITOR_GROUPS) return { tree: node, focusGroupId: groupId };

  let focusGroupId = groupId;
  const tree = replaceGroup(node, groupId, (group) => {
    const active = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];

    if (active === undefined) return group;
    const movedTab: EditorTab =
      active.kind === "welcome" ? { ...active, id: freshId() } : { ...active, preview: false };
    const newGroup = makeGroup([movedTab]);

    focusGroupId = newGroup.id;
    const orientation = direction === "left" || direction === "right" ? "horizontal" : "vertical";
    const newFirst = direction === "left" || direction === "up";
    const remainingTabs =
      active.kind === "welcome" ? group.tabs : group.tabs.filter((tab) => tab.id !== active.id);
    const sourceTabs =
      remainingTabs.length > 0
        ? remainingTabs
        : [findTabByKind(node, "changes") ? welcomeTab() : changesTab()];
    const sourceGroup = {
      ...group,
      tabs: sourceTabs,
      activeTabId: sourceTabs[0]!.id,
    };
    const children = newFirst ? [newGroup, sourceGroup] : [sourceGroup, newGroup];

    return { type: "branch", id: freshId(), orientation, children };
  });

  return { tree, focusGroupId };
}
