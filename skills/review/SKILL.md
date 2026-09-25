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
5. Run the configured review skill in that workspace. Give it the PR base SHA as its fixed point, the PR body as its spec source, and the existing review comments as deduplication context. For the built-in `code-review` skill, this context is complete: use `gh issue view` for issue references and do not require repository-specific issue-tracker setup. The built-in skill is vendored verbatim from [mattpocock/skills](https://github.com/mattpocock/skills/tree/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/engineering/code-review).
6. Create the Thread from that workspace:
   `cueloop review <pull-request> --head-sha <headRefOid> --no-tui --brief-file <brief-file>`
7. Record each actionable finding with `cueloop review-comment <thread-id>`. Give it:
   - `--path`, `--line`, and `--side LEFT|RIGHT`
   - `--severity p0|p1|p2`
   - `--title`
   - `--body` or `--body-file`
   - optional `--suggestion-file` and `--prompt-file`
8. Open the Thread with `cueloop review-open <thread-id>`. Keep this turn open and run `cueloop session wait <thread-id> --timeout-ms 60000`. After each wait, run `cueloop session get <thread-id>` and inspect `history.entries` for Message IDs you have not handled. Act on each new Message, including a `comment` Message that leaves the Thread pending. Repeat the wait while the status is pending. Use replies to refine findings in the same Thread. Do not end the turn while waiting for a CLI-created review: it has no harness binding to wake the agent.

The Thread Message is an instruction to the agent. If it directs you to post findings, post the selected unresolved agent findings. If it directs you to approve or request changes, use that event. Do not ask for the same authorization again in the agent conversation. Resolving the Thread does not itself post to GitHub; the agent must run:

`cueloop review-post <thread-id> --comments C1,C3 --event comment|approve|request-changes [--body-file <draft>]`

Omit `--comments` to post every unresolved agent finding. Human comments and replies stay local. Default to `--event comment` unless the Message asks to approve or request changes. The Message's text is private instructions for the agent, not the GitHub review body. Draft a separate, author-facing review body with `--body-file` only when needed; approval with inline findings can leave it empty.

If import or posting fails, run `gh auth status`.
