---
name: review
description: Review a GitHub pull request in cueloop, record agent findings on the diff, and refine them with the user before any explicit GitHub post.
---

# cueloop review

Use this workflow for `/cueloop:review <pull-request>`.

1. Run `cueloop review-config`. Read `skill` and `workspace`.
2. Read the pull request with `gh pr view <pull-request> --json number,title,body,url,baseRefOid,headRefOid`. Also read its existing review comments. Give them to the configured skill as deduplication context, but do not copy them into the cueloop Thread.
3. Work at the exact PR head:
   - `worktree`: create or reuse `~/.cueloop/worktrees/<owner>-<repo>/pr-<number>-<short-sha>`, fetch the head, and add it as a detached git worktree.
   - `current`: compare `git rev-parse HEAD` with `headRefOid`. Stop if they differ.
4. Write a short review brief with the PR title, a `## TL;DR` of two to four bullets, and the original body under `## PR description`.
5. Run the configured review skill in that workspace. The built-in default is `code-review`, vendored from [mattpocock/skills](https://github.com/mattpocock/skills/tree/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/engineering/code-review).
6. Create the Thread from that workspace:
   `cueloop review <pull-request> --head-sha <headRefOid> --no-tui --brief-file <brief-file>`
7. Record each actionable finding with `cueloop review-comment <thread-id>`. Give it:
   - `--path`, `--line`, and `--side LEFT|RIGHT`
   - `--severity p0|p1|p2`
   - `--title`
   - `--body` or `--body-file`
   - optional `--suggestion-file` and `--prompt-file`
8. Open the Thread with `cueloop review-open <thread-id>`, then wait for its Message. Use replies to refine findings in the same Thread.

Resolving the Thread never posts to GitHub. Only post after the user explicitly asks in the agent conversation. Use:

`cueloop review-post <thread-id> --comments C1,C3 --event comment|approve|request-changes`

Omit `--comments` to post every unresolved agent finding. Human comments and replies stay local. Default to `--event comment` unless the user explicitly asks to approve or request changes.

If import or posting fails, run `gh auth status`.
