/**
 * Builds a nested file tree from a diff's changed files, so the Changes column
 * can browse them by directory. Each leaf keeps its repo-relative path as the id
 * (what the diff rows are keyed by) and carries the git status for its tint.
 */

import type { DiffFileContents, DiffFileStatus } from "@cueloop/schema";
import type { GitStatus, TreeNode } from "./primitives/tree-model";

/** The diff file statuses are a subset of the tree's git statuses. */
function gitStatusOf(status: DiffFileStatus): GitStatus {
  return status;
}

interface MutableTreeNode {
  id: string;
  label: string;
  status?: GitStatus;
  children?: Map<string, MutableTreeNode>;
}

function freeze(node: MutableTreeNode): TreeNode {
  if (node.children === undefined)
    return { id: node.id, label: node.label, status: node.status };

  return {
    id: node.id,
    label: node.label,
    children: [...node.children.values()].map(freeze),
  };
}

/** Group changed files into a directory tree; leaves are keyed by their full path. */
export function buildFileTree(files: readonly DiffFileContents[]): TreeNode[] {
  const roots = new Map<string, MutableTreeNode>();

  for (const file of files) {
    const segments = file.path
      .split("/")
      .filter((segment) => segment.length > 0);
    let level = roots;
    let prefix = "";

    segments.forEach((segment, index) => {
      prefix = prefix.length > 0 ? `${prefix}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = level.get(segment);

      if (node === undefined) {
        node = isLeaf
          ? { id: file.path, label: segment, status: gitStatusOf(file.status) }
          : { id: prefix, label: segment, children: new Map() };
        level.set(segment, node);
      }
      if (!isLeaf) level = node.children!;
    });
  }

  return [...roots.values()].map(freeze);
}
