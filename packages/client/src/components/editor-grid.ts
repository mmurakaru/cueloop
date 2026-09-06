// The Changes pane's editor layout, modeled on VSCode's editor grid: a tree of nodes where a leaf is
// an editor group (a tab strip plus its one active tab) and a branch splits child nodes along an
// orientation. Splitting an editor group moves its active tab into a new group; a group is pruned
// when its last tab closes, collapsing the branch that held it.

/** One editor in a group's tab strip: the Changes tab (the whole diff) or a per-file tab. */
export interface EditorTab {
  id: string;
  kind: "changes" | "file";
  label: string;
  /** Repo-relative path for a file tab; absent for the Changes tab. */
  path?: string;
  /** A file tab shows either a single-file diff or the file's plain contents. */
  fileView?: "diff" | "contents";
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

/** A file tab, opened from a tree; a diff view for a changed file, plain contents otherwise. */
export function fileTab(label: string, path: string, fileView: "diff" | "contents"): EditorTab {
  return { id: freshId(), kind: "file", label, path, fileView };
}

/** The id of the first editor group in reading order; the fallback focus target. */
export function firstGroupId(node: EditorNode): string {
  return node.type === "group" ? node.id : firstGroupId(node.children[0]!);
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
  let focusGroupId = groupId;
  const tree = replaceGroup(node, groupId, (group) => {
    const active = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
    if (active === undefined) return group;
    const movedTab: EditorTab = { ...active, id: freshId() };
    const newGroup = makeGroup([movedTab]);
    focusGroupId = newGroup.id;
    const orientation = direction === "left" || direction === "right" ? "horizontal" : "vertical";
    const newFirst = direction === "left" || direction === "up";
    const children = newFirst ? [newGroup, group] : [group, newGroup];
    return { type: "branch", id: freshId(), orientation, children };
  });
  return { tree, focusGroupId };
}
