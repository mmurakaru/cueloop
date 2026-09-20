import { describe, expect, test } from "bun:test";
import { resolveNavKey } from "./thread-chords";

const owner = { isOwner: true, resolved: false, treeActive: false };
const readOnly = { type: "status" as const, message: "observer - read-only" };
const submitted = { type: "status" as const, message: "review submitted - read-only" };

describe("resolveNavKey", () => {
  test("the session commands: submit, edit, share", () => {
    expect(resolveNavKey({ name: "return" }, owner)).toEqual({ type: "openSubmit" });
    expect(resolveNavKey({ name: "enter" }, owner)).toEqual({ type: "openSubmit" });
    expect(resolveNavKey({ name: "e" }, owner)).toEqual({ type: "edit" });
    expect(resolveNavKey({ name: "s" }, owner)).toEqual({ type: "share" });
  });

  test("a diff row's keys win over the shared letters, then fall through to curation", () => {
    const diff = { ...owner, isDiff: true };

    expect(resolveNavKey({ name: "x" }, diff)).toEqual({ type: "rejectChange" });
    expect(resolveNavKey({ name: "c" }, diff)).toEqual({ type: "foldFile" });
    expect(resolveNavKey({ name: "d" }, diff)).toEqual({ type: "toggleDiffView" });
    expect(resolveNavKey({ name: "k" }, diff)).toEqual({ type: "walkStart" });
    // a letter with no diff meaning still reaches the curation commands
    expect(resolveNavKey({ name: "n" }, diff)).toEqual({ type: "nextAnnotation" });
  });

  test("the discussion and curation commands", () => {
    expect(resolveNavKey({ name: "n" }, owner)).toEqual({ type: "nextAnnotation" });
    expect(resolveNavKey({ name: "p" }, owner)).toEqual({ type: "prevAnnotation" });
    expect(resolveNavKey({ name: "backspace" }, owner)).toEqual({ type: "removeAnnotation" });
    expect(resolveNavKey({ name: "r" }, owner)).toEqual({ type: "openRename" });
    expect(resolveNavKey({ name: "x" }, owner)).toEqual({ type: "cut" });
    expect(resolveNavKey({ name: "u" }, owner)).toEqual({ type: "restoreCuration" });
  });

  test("the tree commands: toggle, move on the Tree tab, go, branch, label, fork, hand off", () => {
    const onTree = { ...owner, treeActive: true };

    expect(resolveNavKey({ name: "t" }, owner)).toEqual({ type: "toggleTree" });
    expect(resolveNavKey({ name: "n" }, onTree)).toEqual({ type: "treeMove", direction: 1 });
    expect(resolveNavKey({ name: "p" }, onTree)).toEqual({ type: "treeMove", direction: -1 });
    expect(resolveNavKey({ name: "g" }, owner)).toEqual({ type: "treeGo" });
    expect(resolveNavKey({ name: "b" }, owner)).toEqual({ type: "treeBranch" });
    expect(resolveNavKey({ name: "l" }, owner)).toEqual({ type: "treeLabel" });
    expect(resolveNavKey({ name: "f" }, owner)).toEqual({ type: "treeFork" });
    expect(resolveNavKey({ name: "h" }, owner)).toEqual({ type: "treeForkShare" });
  });

  test("a shift letter resolves as its uppercase, which no command claims, so it returns to typing", () => {
    expect(resolveNavKey({ name: "x", shift: true }, { ...owner, isDiff: true })).toBeNull();
  });

  test("a collaborator is refused the owner's commands; renaming stays open", () => {
    const collaborator = { ...owner, isOwner: false };

    expect(resolveNavKey({ name: "return" }, collaborator)).toEqual(readOnly);
    expect(resolveNavKey({ name: "e" }, collaborator)).toEqual(readOnly);
    expect(resolveNavKey({ name: "s" }, collaborator)).toEqual(readOnly);
    expect(resolveNavKey({ name: "x" }, collaborator)).toEqual(readOnly);
    expect(resolveNavKey({ name: "g" }, collaborator)).toEqual(readOnly);
    expect(resolveNavKey({ name: "f" }, collaborator)).toEqual(readOnly);
    expect(resolveNavKey({ name: "r" }, collaborator)).toEqual({ type: "openRename" });
  });

  test("a resolved review refuses every change and says so; a fork stays open", () => {
    const resolved = { ...owner, resolved: true };

    expect(resolveNavKey({ name: "return" }, resolved)).toBeNull();
    expect(resolveNavKey({ name: "e" }, resolved)).toEqual(submitted);
    expect(resolveNavKey({ name: "x" }, resolved)).toEqual(submitted);
    expect(resolveNavKey({ name: "b" }, resolved)).toEqual(submitted);
    expect(resolveNavKey({ name: "f" }, resolved)).toEqual({ type: "treeFork" });
    expect(resolveNavKey({ name: "s" }, resolved)).toEqual({ type: "share" });
  });

  test("an unmapped key returns null, so the surface returns to typing", () => {
    expect(resolveNavKey({ name: "z" }, owner)).toBeNull();
    expect(resolveNavKey({ name: "j" }, owner)).toBeNull();
  });
});
