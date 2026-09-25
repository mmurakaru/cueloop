---
name: cueloop
description: Review coding-agent plans, replies, diffs, prototypes, or pull requests in a terminal Thread and return human comments as a Message.
---

# cueloop

Use cueloop when a coding task needs a human review before the agent continues.

## Review work

1. Submit the full artifact with one workflow: `plan`, `reply`, `diff`, `prototype`, or `review`.
2. Wait while the human reads the Thread and adds comments.
3. Receive the resolved Message from the cueloop integration.
4. Apply the Message in the same agent conversation.
5. Revise the existing Thread when the Message requests changes.

## Choose a workflow

- Use `plan` for an implementation plan.
- Use `reply` for an agent response.
- Use `diff` for working-tree changes.
- Use `prototype` for a component design document.
- Use `review` for pull-request changes.
- Use `refine` to summarize repeated comments from earlier Threads.

## Interpret the Message

- `comment` sends new comments and keeps the Thread open.
- `approved` sends comments and completes the review round.
- `changes_requested` sends comments and asks for a revision.

Read https://www.cueloop.dev/docs/agents/index.md for integration setup and https://www.cueloop.dev/openapi.json for public discovery metadata.
