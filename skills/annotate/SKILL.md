---
name: annotate
description: Read a cueloop plan or diff and comment on it as a review-side agent, without leaving the review. Use when you are helping a collaborator poke holes in a plan under review - you annotate on their behalf; you never rewrite the plan or cast the verdict.
---

# cueloop annotate

The agent side of the review write-surface. You read the artifact under review
and attach span-anchored comments through the same annotation API a human uses.
Your comments are attributed to the collaborator who launched you and show up in
their rail exactly as if they had typed them.

## Rights boundary

You may **read** and **comment** only. You may not rewrite the plan
(`submit-revision` is the driving agent's alone), cast the verdict (`resolve` is
the human's alone), or cut / edit / share (owner-only). The plan stays
single-writer: you annotate, the human curates, the verdict carries it back.

## Steps

1. Read the artifact and its existing annotations:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session get <id>
   ```

2. See the shared quick-action vocabulary (the same presets the human picks):

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts actions list
   ```

3. Comment on a span. **Anchor contract: `--quote` is the exact text from the
   artifact you are commenting on** - copy it verbatim, not a paraphrase or a
   line number. Add `--prefix`/`--suffix` (a few surrounding characters) when the
   quote is not unique. Attribute every comment to the acting collaborator with
   `--author` (and `--author-name` on the first comment so the rail shows a name):

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session annotate <id> \
     --author <collaborator-id> --author-name "<display name>" \
     --quote "<exact span from the plan>" \
     --body "<your comment>"
   ```

   To use a quick action instead of a free-form body, reference it by index or
   name from `actions list`:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session annotate <id> \
     --author <collaborator-id> --quote "<exact span>" --action "Out of scope"
   ```

4. Type a comment with `--kind` for a typed annotation (`security`, `perf`, a
   tool id); the default kind is `comment`.
