import { describe, expect, test } from "bun:test";
import {
  addTab,
  changesTab,
  closeTab,
  countEditorGroups,
  containsGroup,
  fileTab,
  firstGroupId,
  keepFileTab,
  makeGroup,
  MAX_EDITOR_GROUPS,
  openFileTab,
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

  test("a new preview replaces the group's previous preview", () => {
    const group = makeGroup([changesTab()]);
    const first = asGroup(openFileTab(group, group.id, "src/a.ts", "contents", false).tree);
    const second = asGroup(openFileTab(first, group.id, "src/b.ts", "contents", false).tree);

    expect(second.tabs.map((tab) => tab.path)).toEqual([undefined, "src/b.ts"]);
    expect(second.tabs[1]?.preview).toBe(true);
  });

  test("keeping a preview makes subsequent previews open beside it", () => {
    const group = makeGroup([changesTab()]);
    const preview = asGroup(openFileTab(group, group.id, "src/a.ts", "contents", false).tree);
    const kept = asGroup(keepFileTab(preview, group.id, preview.activeTabId!));
    const next = asGroup(openFileTab(kept, group.id, "src/b.ts", "contents", false).tree);

    expect(next.tabs.map((tab) => tab.path)).toEqual([undefined, "src/a.ts", "src/b.ts"]);
    expect(next.tabs[1]?.preview).toBe(false);
  });

  test("reopening a file focuses its existing tab across groups and changes its view", () => {
    const group = makeGroup([changesTab()]);
    const open = asGroup(openFileTab(group, group.id, "src/a.ts", "contents", true).tree);
    const { tree } = splitGroup(open, group.id, "right");
    const branch = asBranch(tree);
    const right = asGroup(branch.children[1]!);
    const reopened = openFileTab(tree, group.id, "src/a.ts", "diff", false);

    expect(reopened.focusGroupId).toBe(right.id);
    expect(asGroup(asBranch(reopened.tree).children[1]!).tabs).toHaveLength(1);
    expect(asGroup(asBranch(reopened.tree).children[1]!).tabs[0]).toMatchObject({
      path: "src/a.ts",
      fileView: "diff",
      preview: false,
    });
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
    expect(asGroup(branch.children[0]!).tabs.some((tab) => tab.path === "src/App.tsx")).toBe(false);
  });

  test("splitting up makes a vertical branch with the new group first", () => {
    const group = makeGroup([fileTab("a.ts", "a.ts", "contents")]);
    const { tree, focusGroupId } = splitGroup(group, group.id, "up");
    const branch = asBranch(tree);

    expect(branch.orientation).toBe("vertical");
    expect(branch.children[0]!.id).toBe(focusGroupId);
  });

  test("splitting a file-only group keeps the Changes tab unique", () => {
    const changes = makeGroup([changesTab()]);
    const file = makeGroup([fileTab("a.ts", "a.ts", "diff")]);
    const tree: EditorNode = {
      type: "branch",
      id: "two-groups",
      orientation: "horizontal",
      children: [changes, file],
    };
    const split = splitGroup(tree, file.id, "down");

    expect(asBranch(split.tree).children[0]).toBe(changes);
    expect(asBranch(asBranch(split.tree).children[1]!).children[0]).toMatchObject({
      tabs: [{ kind: "welcome" }],
    });
  });

  test("splitting Changes moves it to the new group", () => {
    const group = makeGroup([changesTab()]);
    const split = splitGroup(group, group.id, "right");
    const branch = asBranch(split.tree);

    expect(asGroup(branch.children[0]!).tabs[0]?.kind).toBe("welcome");
    expect(asGroup(branch.children[1]!).tabs[0]?.kind).toBe("changes");
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

  test("containsGroup finds a live group and misses a pruned one", () => {
    const group = makeGroup([fileTab("a.ts", "a.ts", "diff")]);
    const { tree } = splitGroup(group, group.id, "right");
    const branch = asBranch(tree);
    const rightGroup = asGroup(branch.children[1]!);

    expect(containsGroup(tree, group.id)).toBe(true);
    const collapsed = closeTab(tree, rightGroup.id, rightGroup.tabs[0]!.id);

    expect(containsGroup(asGroup(collapsed), rightGroup.id)).toBe(false);
  });

  test("mixed split directions stop at eight editor groups", () => {
    const first = makeGroup([changesTab()]);
    let tree: EditorNode = first;
    let focusGroupId = first.id;
    const directions = ["right", "up", "left", "down"] as const;

    for (const direction of [...directions, ...directions]) {
      const result = splitGroup(tree, focusGroupId, direction);

      tree = result.tree;
      focusGroupId = result.focusGroupId;
    }

    expect(countEditorGroups(tree)).toBe(MAX_EDITOR_GROUPS);
    const excess = splitGroup(tree, focusGroupId, "right");

    expect(excess.tree).toBe(tree);
    expect(excess.focusGroupId).toBe(focusGroupId);
  });
});
