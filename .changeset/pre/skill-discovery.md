---
"cueloop": minor
---

The "/" palette now lists your user-level skills alongside cueloop's quick actions. Skills are discovered from `~/.agents/skills` by default (each `<name>/SKILL.md` with a name and description in its frontmatter); set `[skills] path` in your config to point elsewhere. Picking a skill inserts its `/name` and sends it to the agent as-is, since any harness already has it; a quick action of the same name takes precedence.
