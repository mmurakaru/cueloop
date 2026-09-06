import { describe, expect, test } from "bun:test";
import {
  addTab,
  changesTab,
  closeTab,
  fileTab,
  firstGroupId,
  makeGroup,
  splitGroup,
  type EditorBranch,
  type EditorGroup,
  type EditorNode,
} from "./editor-grid";

function asBranch(node: EditorNode | null): EditorBranch {
  if (node === null || node.type !== "branch") throw new Error("expected a branch node");
  return node;
}
function asGroup(node: EditorNode | null): EditorGroup {
  if (node === null || node.type !== "group") throw new Error("expected a group node");
  return node;
}

describe("editor grid", () => {
  test("a fresh group holds its tabs with the first active", () => {
    const tab = changesTab();
    const group = makeGroup([tab]);
    expect(group.type).toBe("group");
    expect(group.activeTabId).toBe(tab.id);
  });

  test("adding a tab focuses it", () => {
    const group = makeGroup([changesTab()]);
    const file = fileTab("App.tsx", "src/App.tsx", "diff");
    const next = asGroup(addTab(group, group.id, file));
    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe(file.id);
  });

  test("splitting right makes a horizontal branch and focuses the new group", () => {
    const group = makeGroup([fileTab("App.tsx", "src/App.tsx", "diff")]);
    const { tree, focusGroupId } = splitGroup(group, group.id, "right");
    expect(tree.type).toBe("branch");
    const branch = asBranch(tree);
    expect(branch.orientation).toBe("horizontal");
    expect(branch.children).toHaveLength(2);
    // the new group is the second child (right edge) and takes focus
    expect(branch.children[1]!.id).toBe(focusGroupId);
    expect(firstGroupId(tree)).toBe(group.id);
  });

  test("splitting up makes a vertical branch with the new group first", () => {
    const group = makeGroup([fileTab("a.ts", "a.ts", "contents")]);
    const { tree, focusGroupId } = splitGroup(group, group.id, "up");
    const branch = asBranch(tree);
    expect(branch.orientation).toBe("vertical");
    expect(branch.children[0]!.id).toBe(focusGroupId);
  });

  test("closing the last tab of a split collapses the branch back to one group", () => {
    const group = makeGroup([fileTab("a.ts", "a.ts", "diff")]);
    const { tree } = splitGroup(group, group.id, "right");
    const branch = asBranch(tree);
    const rightGroup = asGroup(branch.children[1]!);
    const collapsed = closeTab(tree, rightGroup.id, rightGroup.tabs[0]!.id);
    expect(collapsed?.type).toBe("group");
    expect(asGroup(collapsed).id).toBe(group.id);
  });

  test("closing the only tab of the whole grid returns null", () => {
    const tab = changesTab();
    const group = makeGroup([tab]);
    expect(closeTab(group, group.id, tab.id)).toBeNull();
  });
});
