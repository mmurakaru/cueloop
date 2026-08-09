import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editInEditor, resolveEditor, resolveEditorCommand } from "./editor";

describe("resolveEditor", () => {
  test("a clean environment falls back to nano so editing always works", () => {
    expect(resolveEditor(undefined, {})).toBe("nano");
  });

  test("the environment chain wins in order: CUELOOP_EDITOR, VISUAL, EDITOR", () => {
    expect(resolveEditor(undefined, { EDITOR: "vim", VISUAL: "code", CUELOOP_EDITOR: "hx" })).toBe("hx");
    expect(resolveEditor(undefined, { EDITOR: "vim", VISUAL: "code" })).toBe("code");
    expect(resolveEditor(undefined, { EDITOR: "vim" })).toBe("vim");
  });

  test("the [ui] editor config overrides the environment", () => {
    expect(resolveEditor("code --wait", { EDITOR: "vim" })).toBe("code --wait");
  });
});

describe("resolveEditorCommand", () => {
  test("a known GUI editor gets its wait flag appended", () => {
    expect(resolveEditorCommand("code")).toEqual({ argv: ["code", "--wait"], klass: "gui", waits: true });
    expect(resolveEditorCommand("subl")).toEqual({ argv: ["subl", "--new-window", "--wait"], klass: "gui", waits: true });
  });

  test("an existing wait flag is not duplicated", () => {
    expect(resolveEditorCommand("code --wait").argv).toEqual(["code", "--wait"]);
  });

  test("a terminal editor is left alone and marked waiting", () => {
    expect(resolveEditorCommand("vim")).toEqual({ argv: ["vim"], klass: "terminal", waits: true });
  });

  test("an unknown editor is neither flagged nor trusted to wait", () => {
    expect(resolveEditorCommand("my-editor")).toEqual({ argv: ["my-editor"], klass: "unknown", waits: false });
  });
});

describe("editInEditor", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cueloop-edit-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A runnable editor stub with a chosen base name and body. */
  function stubEditor(name: string, body: string): string {
    const script = join(dir, name);
    writeFileSync(script, `#!/bin/sh\n${body}\n`);
    chmodSync(script, 0o755);
    return script;
  }

  const instant = (): (() => number) => {
    let value = 0;
    return () => (value += 5);
  };

  test("an editor that changes the file reports the new content", () => {
    const result = editInEditor("old", "plan.md", { editor: stubEditor("writer.sh", `printf 'new' > "$1"`) });
    expect(result).toEqual({ content: "new", changed: true });
  });

  test("a fast, unchanged return opens the gate; confirming re-reads the saved file", () => {
    let askedLabel = "";
    const result = editInEditor("keep", "plan.md", {
      editor: stubEditor("gui-like.sh", "exit 0"),
      now: instant(),
      confirmSaved: (label, path) => {
        askedLabel = label;
        writeFileSync(path, "saved in the GUI");
        return true;
      },
    });
    expect(askedLabel).toContain("gui-like.sh");
    expect(result).toEqual({ content: "saved in the GUI", changed: true });
  });

  test("declining the gate keeps the original content", () => {
    const result = editInEditor("keep", "plan.md", {
      editor: stubEditor("gui-like.sh", "exit 0"),
      now: instant(),
      confirmSaved: () => false,
    });
    expect(result).toEqual({ content: "keep", changed: false });
  });

  test("a terminal editor that makes no change never opens the gate", () => {
    let asked = false;
    const result = editInEditor("keep", "plan.md", {
      editor: stubEditor("vi", "exit 0"),
      now: instant(),
      confirmSaved: () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBeFalse();
    expect(result).toEqual({ content: "keep", changed: false });
  });

  test("a nonzero editor exit throws", () => {
    expect(() => editInEditor("x", "plan.md", { editor: stubEditor("fail.sh", "exit 3") })).toThrow("editor exited 3");
  });
});
