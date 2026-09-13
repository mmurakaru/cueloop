import { createContext } from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as v from "valibot";
import type { SlashItem } from "./slash-palette";

/** The default user-level skill store, harness-agnostic; a config path overrides it. */
export function defaultSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

const SkillNameSchema = v.pipe(v.string(), v.trim(), v.minLength(1));

/** One `key: value` line from the frontmatter, unquoted; undefined when the key is absent. */
function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter);

  return match
    ? match[1]!
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim()
    : undefined;
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
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"));

    if (!frontmatter) continue;
    const name = v.safeParse(
      SkillNameSchema,
      frontmatterValue(frontmatter[1]!, "name") ?? entry.name,
    );

    if (!name.success) continue;

    items.push({
      name: name.output,
      description: frontmatterValue(frontmatter[1]!, "description") ?? "",
      body: "",
    });
  }

  return items;
}

/** Skills reach the composer palette through context, so no surface needs a new prop to list them. */
export const SlashSkillsContext = createContext<SlashItem[]>([]);
