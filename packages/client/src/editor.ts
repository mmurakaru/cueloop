/**
 * File-level edit mode = the $EDITOR hand-off (#22, #11): write the working
 * copy to a temp file, run the user's editor on it, read the result back.
 * Tests point CUELOOP_EDITOR at a non-interactive command.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EditResult {
  content: string;
  changed: boolean;
}

export function editInEditor(content: string, filename = "plan.md"): EditResult {
  const editor = process.env.CUELOOP_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) throw new Error("no editor: set $EDITOR (or $CUELOOP_EDITOR)");
  const dir = mkdtempSync(join(tmpdir(), "cueloop-edit-"));
  const path = join(dir, filename);
  writeFileSync(path, content);
  try {
    const proc = Bun.spawnSync([...editor.split(" "), path], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (proc.exitCode !== 0) throw new Error(`editor exited ${proc.exitCode}`);
    const next = readFileSync(path, "utf8");
    return { content: next, changed: next !== content };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
