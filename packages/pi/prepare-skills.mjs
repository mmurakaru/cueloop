import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const source = join(import.meta.dirname, "../../skills");
const destination = join(import.meta.dirname, "skills");

rmSync(destination, { recursive: true, force: true });

for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const original = join(source, entry.name);
  const packaged = join(destination, entry.name);
  const originalSkill = join(original, "SKILL.md");
  const packagedSkill = join(packaged, "SKILL.md");
  const content = readFileSync(originalSkill, "utf8");
  const originalName = `name: ${entry.name}`;

  if (!content.startsWith(`---\n${originalName}\n`)) {
    throw new Error(`cueloop pi skill name differs from its directory: ${originalSkill}`);
  }

  cpSync(original, packaged, { recursive: true });
  writeFileSync(packagedSkill, content.replace(originalName, `name: cueloop-${entry.name}`));
}
