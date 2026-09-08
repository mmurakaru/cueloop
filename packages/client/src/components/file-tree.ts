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
  badge?: string;
  children?: Map<string, MutableTreeNode>;
}

function freeze(node: MutableTreeNode): TreeNode {
  if (node.children === undefined) {
    const leaf: TreeNode = { id: node.id, label: node.label, status: node.status };

    if (node.badge !== undefined) leaf.badge = node.badge;

    return leaf;
  }

  return {
    id: node.id,
    label: node.label,
    children: [...node.children.values()].map(freeze),
  };
}

/** A file's comment count as a leaf badge, or undefined when it carries none. */
function commentBadge(
  counts: ReadonlyMap<string, number> | undefined,
  path: string,
): string | undefined {
  const count = counts?.get(path);

  return count ? `● ${count}` : undefined;
}

/**
 * Group changed files into a directory tree; leaves are keyed by their full path. A leaf whose
 * file carries comments shows a dot-and-count badge, so feedback is visible even with its tab closed.
 */
export function buildFileTree(
  files: readonly DiffFileContents[],
  commentCounts?: ReadonlyMap<string, number>,
): TreeNode[] {
  const roots = new Map<string, MutableTreeNode>();

  for (const file of files) {
    const segments = file.path.split("/").filter((segment) => segment.length > 0);
    let level = roots;
    let prefix = "";

    segments.forEach((segment, index) => {
      prefix = prefix.length > 0 ? `${prefix}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = level.get(segment);

      if (node === undefined) {
        node = isLeaf
          ? {
              id: file.path,
              label: segment,
              status: gitStatusOf(file.status),
              badge: commentBadge(commentCounts, file.path),
            }
          : { id: prefix, label: segment, children: new Map() };
        level.set(segment, node);
      }
      if (!isLeaf) level = node.children!;
    });
  }

  return [...roots.values()].map(freeze);
}

/** Group plain repo-relative paths (git ls-files) into a directory tree; leaves keep their full path. */
export function buildPathTree(paths: readonly string[]): TreeNode[] {
  const roots = new Map<string, MutableTreeNode>();

  for (const path of paths) {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    let level = roots;
    let prefix = "";

    segments.forEach((segment, index) => {
      prefix = prefix.length > 0 ? `${prefix}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = level.get(segment);

      if (node === undefined) {
        node = isLeaf
          ? { id: path, label: segment }
          : { id: prefix, label: segment, children: new Map() };
        level.set(segment, node);
      }
      if (!isLeaf) level = node.children!;
    });
  }

  return [...roots.values()].map(freeze);
}
