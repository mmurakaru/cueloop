import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./skills";
import { mergeSlashItems, type SlashItem } from "./slash-palette";

function skillDir(): string {
  const root = mkdtempSync(join(tmpdir(), "cueloop-skills-"));

  mkdirSync(join(root, "typescript-magician"));
  writeFileSync(
    join(root, "typescript-magician", "SKILL.md"),
    "---\nname: typescript-magician\ndescription: Design complex generic types.\n---\n\nbody\n",
  );
  mkdirSync(join(root, "no-frontmatter"));
  writeFileSync(join(root, "no-frontmatter", "SKILL.md"), "just prose, no frontmatter\n");

  return root;
}

describe("loadSkills", () => {
  test("reads name and description from each SKILL.md frontmatter", () => {
    const root = skillDir();

    try {
      const skills = loadSkills(root);
      const magician = skills.find((skill) => skill.name === "typescript-magician");

      expect(magician?.description).toBe("Design complex generic types.");
      // a directory whose SKILL.md has no frontmatter is skipped, not crashed on
      expect(skills.some((skill) => skill.name === "no-frontmatter")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing skills directory yields no skills", () => {
    expect(loadSkills(join(tmpdir(), "cueloop-does-not-exist-xyz"))).toEqual([]);
  });

  test("CRLF delimiters parse, and a quoted name is unquoted", () => {
    const root = mkdtempSync(join(tmpdir(), "cueloop-skills-crlf-"));

    try {
      mkdirSync(join(root, "review"));
      writeFileSync(
        join(root, "review", "SKILL.md"),
        '---\r\nname: "review"\r\ndescription: Review the change.\r\n---\r\n',
      );
      const skills = loadSkills(root);

      // no stray quotes and no CRLF-broken frontmatter
      expect(skills.map((skill) => skill.name)).toEqual(["review"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("mergeSlashItems", () => {
  test("a quick action wins a name collision with a skill", () => {
    const actions: SlashItem[] = [{ name: "lgtm", description: "action", body: "LGTM" }];
    const skills: SlashItem[] = [
      { name: "lgtm", description: "skill", body: "" },
      { name: "vitest-patterns", description: "skill", body: "" },
    ];
    const merged = mergeSlashItems(actions, skills);

    expect(merged.filter((item) => item.name === "lgtm")).toHaveLength(1);
    expect(merged.find((item) => item.name === "lgtm")?.description).toBe("action");
    expect(merged.some((item) => item.name === "vitest-patterns")).toBe(true);
  });
});
