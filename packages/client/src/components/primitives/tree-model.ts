// Headless tree model mirrored from @pierre/trees (DOM-only): share the model, render our own.

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "ignored";

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  status?: FileStatus;
  badge?: string;
  icon?: string;
}

export interface FlattenOptions {
  expandedIds: ReadonlySet<string>;
  flattenEmptyDirectories?: boolean;
}

export interface VisibleRow {
  id: string;
  label: string;
  depth: number;
  isFolder: boolean;
  expanded: boolean;
  status?: FileStatus;
  badge?: string;
  icon?: string;
}

function isFolder(node: TreeNode): boolean {
  return node.children !== undefined;
}

interface CollapsedChain {
  label: string;
  tail: TreeNode;
  chainIds: string[];
}

// flattenEmptyDirectories: fold a chain of single-subfolder folders into one row.
function collapseChain(node: TreeNode): CollapsedChain {
  let tail = node;
  const labels = [node.label];
  const chainIds = [node.id];

  while (tail.children?.length === 1 && isFolder(tail.children[0]!)) {
    tail = tail.children[0]!;
    labels.push(tail.label);
    chainIds.push(tail.id);
  }

  return { label: labels.join("/"), tail, chainIds };
}

export function flattenTree(nodes: readonly TreeNode[], options: FlattenOptions): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (list: readonly TreeNode[], depth: number): void => {
    for (const node of list) {
      if (!isFolder(node)) {
        const leaf: VisibleRow = {
          id: node.id,
          label: node.label,
          depth,
          isFolder: false,
          expanded: false,
        };

        if (node.status !== undefined) leaf.status = node.status;
        if (node.badge !== undefined) leaf.badge = node.badge;
        if (node.icon !== undefined) leaf.icon = node.icon;
        rows.push(leaf);
        continue;
      }
      const collapsed = options.flattenEmptyDirectories
        ? collapseChain(node)
        : { label: node.label, tail: node, chainIds: [node.id] };
      // open when any id along a collapsed chain is expanded
      const expanded = collapsed.chainIds.some((id) => options.expandedIds.has(id));
      const row: VisibleRow = {
        id: node.id,
        label: collapsed.label,
        depth,
        isFolder: true,
        expanded,
      };

      if (node.badge !== undefined) row.badge = node.badge;
      if (node.icon !== undefined) row.icon = node.icon;
      rows.push(row);
      if (expanded) walk(collapsed.tail.children ?? [], depth + 1);
    }
  };

  walk(nodes, 0);

  return rows;
}

export function allFolderIds(nodes: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      if (isFolder(node)) {
        ids.add(node.id);
        walk(node.children ?? []);
      }
    }
  };

  walk(nodes);

  return ids;
}

export type TreeTone = "green" | "blue" | "red" | "muted";

export interface StatusMeta {
  letter: string;
  tone: TreeTone;
}

export function statusMeta(status: FileStatus): StatusMeta {
  switch (status) {
    case "added":
      return { letter: "A", tone: "green" };
    case "modified":
      return { letter: "M", tone: "blue" };
    case "deleted":
      return { letter: "D", tone: "red" };
    case "renamed":
      return { letter: "R", tone: "blue" };
    case "untracked":
      return { letter: "U", tone: "green" };
    case "ignored":
      return { letter: "I", tone: "muted" };
  }
}
