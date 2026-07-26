# Research: Codex CLI hook capabilities

Resolves [issue #4](https://github.com/mmurakaru/cueloop/issues/4).
Question: what do Codex CLI hooks deliver at approval time, and what raw material exists for extracting a plan artifact?

All claims below were verified against the `openai/codex` repository source (main branch, read 2026-07-26) unless marked otherwise.
The official docs page is https://developers.openai.com/codex/hooks (it currently 308-redirects to https://learn.chatgpt.com/docs/hooks).

## Summary

- Codex CLI has a stable, default-enabled lifecycle hook system (feature key `hooks`) with 11 events, including `PermissionRequest` and `PreToolUse`.
- `PermissionRequest` fires in the approval path before the approval UI is shown and can return a binding allow/deny decision; silence falls through to the normal approval flow.
- At approval time the richest raw material is: the full `apply_patch` diff in `tool_input.command`, the shell command being approved, and `transcript_path` - the session rollout JSONL, which contains the model's `update_plan` calls and assistant messages.
- No hook event carries a dedicated plan document; a plan artifact must be extracted from the transcript or produced by convention (AGENTS.md contract + known-file write), both feasible.

## Event set

Source: [`codex-rs/config/src/hook_config.rs`](https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs) (`HookEventsToml`).

`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`.

Handlers are shell commands (`type: "command"`) selected per event by a `matcher` regex against the tool name.
JSON Schemas for every event's stdin input and stdout output are generated in [`codex-rs/hooks/schema/generated/`](https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated).

## Configuration

- Hooks are a stable feature, enabled by default: `FeatureSpec { id: Feature::CodexHooks, key: "hooks", stage: Stage::Stable, default_enabled: true }` in [`codex-rs/features/src/lib.rs`](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs). Disable with `[features] hooks = false` in `config.toml`.
- Hooks are discovered per config layer (managed/requirements, user `~/.codex`, project `.codex`, plugins), from either a `hooks.json` file in the layer's config folder or an inline `[hooks]` TOML table; loading both in one layer emits a warning ([`codex-rs/hooks/src/engine/discovery.rs`](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs)).
- Non-managed hooks require interactive trust review (`/hooks`); admins can set `allow_managed_hooks_only = true` in `requirements.toml` ([`docs/config.md`](https://github.com/openai/codex/blob/main/docs/config.md)).

`hooks.json` shape (matcher groups per event):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "apply_patch",
        "hooks": [
          { "type": "command", "command": "cueloop-review-gate", "timeout": 600 }
        ]
      }
    ]
  }
}
```

## PermissionRequest: payload and decision contract

Source: [`codex-rs/hooks/src/events/permission_request.rs`](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/permission_request.rs), [PR #17563](https://github.com/openai/codex/pull/17563), schemas [`permission-request.command.input.schema.json`](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/permission-request.command.input.schema.json) and [`permission-request.command.output.schema.json`](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/permission-request.command.output.schema.json).

The event runs in the approval path, before the user approval UI is shown.
Stdin payload (example from PR #17563 for a shell approval):

```json
{
  "session_id": "<session-id>",
  "turn_id": "<turn-id>",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/cwd",
  "hook_event_name": "PermissionRequest",
  "model": "gpt-5",
  "permission_mode": "default",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -f /tmp/example", "description": "optional justification" }
}
```

Response contract:

- Exit 0 with empty stdout: no verdict; the normal approval UI proceeds (this enables pure side-effect hooks, e.g. notify an external reviewer).
- Exit 0 with JSON verdict:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

or `{ "behavior": "deny", "message": "reason shown as feedback" }`.

- Exit 2 with a reason on stderr: deny.
- Decision folding across multiple matching hooks is conservative: any deny wins; otherwise the highest-precedence allow wins; otherwise no verdict.
- `updatedInput`, `updatedPermissions`, and `interrupt` exist in the wire schema but are reserved; a hook emitting them today fails closed (marked as reserved in the output schema; listed as follow-ups in PR #17563).
- An allow from the hook resolves the approval as `ReviewDecision::Approved` with source `Hook`, fully replacing the UI prompt ([`codex-rs/core/src/tools/approvals.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/approvals.rs)).

What fires `PermissionRequest` (implementers of `permission_request_payload` plus wiring): shell, unified exec (`exec_command`), `apply_patch`, network approvals, and MCP tool approvals ([`codex-rs/core/src/tools/runtimes/`](https://github.com/openai/codex/tree/main/codex-rs/core/src/tools/runtimes), [`codex-rs/core/src/mcp_tool_call.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_call.rs)).
Notably, for `apply_patch` approvals `tool_input.command` carries the raw patch text - the entire proposed diff ([`codex-rs/core/src/tools/runtimes/apply_patch.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/runtimes/apply_patch.rs)):

```rust
PermissionRequestPayload {
    tool_name: HookToolName::apply_patch(),
    tool_input: serde_json::json!({ "command": req.action.patch }),
}
```

## PreToolUse: payload and decision contract

Source: [`codex-rs/core/src/hook_runtime.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/hook_runtime.rs), schemas `pre-tool-use.command.{input,output}.schema.json`.

Runs before every supported tool executes, regardless of whether an approval would be needed.
Input fields: `session_id`, `turn_id`, `agent_id`/`agent_type` (subagents), `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `tool_name`, `tool_use_id`, `tool_input`.
Implementing tools: shell (`Bash`), `apply_patch`, unified exec (`exec_command`, `write_stdin`), MCP tools, and code-mode wait.
Matcher aliases exist for compatibility: `Write`/`Edit` select `apply_patch` handlers and `Agent` selects `spawn_agent`, but the serialized `tool_name` stays canonical ([`codex-rs/core/src/tools/hook_names.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/hook_names.rs)).

Output contract (`hookSpecificOutput.hookEventName: "PreToolUse"`):

- `permissionDecision`: `"allow" | "deny" | "ask"`, with `permissionDecisionReason`.
- `updatedInput`: honored on allow - the hook can rewrite the tool input.
- `additionalContext`: injected back into the model conversation (spilled to a temp file above roughly 2,500 tokens).
- Exit 2 + stderr, or the legacy `{ "decision": "block", "reason": ... }`, blocks the call; the reason is fed back to the model.

## Approval policy and sandbox interaction

- `PermissionRequest` only fires when Codex actually enters the approval path; that is governed by `approval_policy` (`untrusted`, `on-request`, `on-failure`, `never`) and by sandbox escalation (a command needing to escape `workspace-write`/`read-only` triggers an approval).
- With `approval_policy = "never"` there are no approval prompts, so no `PermissionRequest` events; hooks see `permission_mode: "bypassPermissions"` in payloads. All other policies map to `permission_mode: "default"` (`hook_permission_mode` in [`codex-rs/core/src/hook_runtime.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/hook_runtime.rs)).
- `PreToolUse` fires independently of approval policy, so it is the reliable interception point under permissive policies; a `PreToolUse` deny blocks the call outright, while a `PermissionRequest` deny resolves the approval as denied with the hook's message.
- Hooks themselves run as plain shell commands on the host, outside the model's sandbox.

## Does any event carry a plan-like document?

No event has a dedicated plan field. The plan-adjacent raw material:

- `transcript_path` (on every event payload) points to the session rollout JSONL ([`hook_transcript_path` in `codex-rs/core/src/session/mod.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/mod.rs)). The rollout records the model conversation, including `update_plan` tool calls whose arguments are the structured step list (`UpdatePlanArgs`: plan steps with `pending`/`in_progress`/`completed` status). Confidence: high that update_plan calls are in the rollout; medium on exact JSONL line shape - verify empirically before parsing.
- The built-in `update_plan` tool itself does not fire `PreToolUse`/`PostToolUse` - its handler ([`codex-rs/core/src/tools/handlers/plan.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/plan.rs)) does not implement the hook payload methods, so you cannot intercept plan updates directly. Confidence: high.
- `Stop`/`SubagentStop` payloads include `last_assistant_message` ([`stop.command.input.schema.json`](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/stop.command.input.schema.json)) - useful for end-of-turn summaries, not approval-time plans.
- For `apply_patch` approvals the full diff is in `tool_input.command`; for shell approvals the exact command plus an optional model-written `description` (justification).

## Candidate conventions for a reviewable plan artifact

1. Transcript mining (no agent cooperation needed).
   A `PermissionRequest` hook reads `transcript_path`, extracts the latest `update_plan` arguments and recent assistant messages, and renders them as the plan artifact alongside the pending command/patch.
   Tradeoffs: zero prompt overhead and works today; depends on the model actually using `update_plan` (it usually does for multi-step work) and on an undocumented rollout line format that can drift between releases.

2. AGENTS.md contract + known-file write.
   AGENTS.md instructs the agent to write `.codex/plan.md` (goal, steps, files to touch, risks) before its first mutating action; the `PermissionRequest`/`PreToolUse` hook denies with a corrective message when the file is missing or stale, and otherwise surfaces it for review.
   Tradeoffs: produces a clean, purpose-built document and the deny message is a strong enforcement loop; costs a turn of latency, relies on instruction-following, and needs a staleness rule (e.g. plan mtime newer than session start, or a turn_id stamp inside the file).

3. Hybrid: enforce the known-file contract via hook deny, but fall back to transcript mining when the file is absent, so review is never blocked on model compliance.
   This is the most robust option for cueloop's purposes.

A note on plan-file writes: if the agent writes `.codex/plan.md` via `apply_patch` inside a `workspace-write` sandbox, no approval fires for that write itself; the enforcement point is the next privileged action's `PermissionRequest` (or any `PreToolUse` under `never`).

## Open questions

- Exact JSONL schema of rollout lines for `update_plan` calls (verify empirically against a live session before building a parser).
- Whether `PermissionRequest` will gain `updatedInput`/`updatedPermissions`/suggestions (listed as follow-ups in PR #17563); that would allow a reviewer UI to modify rather than just gate.
- The `request_permissions` tool path is not yet wired into `PermissionRequest` hooks (PR #17563 follow-up), so some granular permission requests may bypass hooks.
- Hook execution timeout defaults and the docs-site content should be re-verified against the docs page once the `developers.openai.com` -> `learn.chatgpt.com` migration settles; source code was treated as authoritative here.

## Sources

- Official docs: https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks)
- PR adding PermissionRequest hooks: https://github.com/openai/codex/pull/17563
- Event set and TOML/JSON config: https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs
- PermissionRequest semantics and decision folding: https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/permission_request.rs
- Output parsing (all events): https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/output_parser.rs
- Generated JSON Schemas: https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated
- Hook runtime and permission_mode mapping: https://github.com/openai/codex/blob/main/codex-rs/core/src/hook_runtime.rs
- Approval integration: https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/approvals.rs
- apply_patch payload: https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/runtimes/apply_patch.rs
- Tool name aliases: https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/hook_names.rs
- Feature flag: https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs
- Hook discovery layers: https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs
- update_plan handler (no hook payload): https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/plan.rs
- Managed hooks admin controls: https://github.com/openai/codex/blob/main/docs/config.md
