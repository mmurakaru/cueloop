import { createContext } from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SlashItem } from "./slash-palette";

/** The default user-level skill store, harness-agnostic; a config path overrides it. */
export function defaultSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

/** User skills as palette items: each `<dir>/SKILL.md` whose frontmatter carries a name and description. */
export function loadSkills(dir: string): SlashItem[] {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: SlashItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let text;

    try {
      text = readFileSync(join(dir, entry.name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text);

    if (!frontmatter) continue;
    const name = /^name:\s*(.+)$/m.exec(frontmatter[1]!)?.[1]?.trim() ?? entry.name;
    const description = /^description:\s*(.+)$/m.exec(frontmatter[1]!)?.[1]?.trim() ?? "";

    items.push({ name, description, body: "" });
  }

  return items;
}

/** Skills reach the composer palette through context, so no surface needs a new prop to list them. */
export const SlashSkillsContext = createContext<SlashItem[]>([]);
