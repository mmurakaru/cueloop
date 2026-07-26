# Claude Code plan-review hook contract

Research for issue #3: the exact I/O contract for intercepting Claude Code at plan approval time.
All claims are sourced from the official Claude Code docs (code.claude.com/docs) and the official changelog, fetched 2026-07-26.

Primary sources:

- Hooks reference: https://code.claude.com/docs/en/hooks
- Hooks guide: https://code.claude.com/docs/en/hooks-guide
- Plugins reference: https://code.claude.com/docs/en/plugins-reference
- Changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

## Summary

Plan approval is a permission dialog for the built-in `ExitPlanMode` tool.
Two hook events can intercept it:

- `PermissionRequest` fires when the permission dialog is about to be shown (interactive sessions only).
- `PreToolUse` fires before the tool executes regardless of permission status, and is the required surface in non-interactive (`claude -p`) mode.

Both receive the plan text on stdin in `tool_input.plan` and can allow or deny with a machine-readable decision.
A denial message is fed back to the model, which then revises the plan and typically calls `ExitPlanMode` again.

## 1. The interception point: ExitPlanMode

`ExitPlanMode` presents a plan and asks the user to approve it before Claude leaves plan mode.
The hooks reference documents its `tool_input` schema (https://code.claude.com/docs/en/hooks, "ExitPlanMode" section):

| Field | Type | Description |
| :--- | :--- | :--- |
| `plan` | string | Plan content in Markdown. Injected from the plan file on disk |
| `planFilePath` | string | Path to the plan file. Injected |
| `allowedPrompts` | array | Deprecated. Accepted but ignored since v2.1.205 |

Important nuance, quoted from the reference:

> Claude writes the plan to a file on disk before calling the tool, so the literal `tool_input` from the model is typically empty.
> Claude Code injects the plan content and file path before passing the input to hooks.

So hooks should read `tool_input.plan` (and `tool_input.planFilePath`), not expect the model to have populated the input.
In `PostToolUse`, the approved plan is in `tool_response.plan` and `tool_response.filePath`; the docs say to read `tool_response.plan` rather than re-reading the file from disk.

## 2. PermissionRequest hook semantics

Source: https://code.claude.com/docs/en/hooks ("PermissionRequest" section).

### When it fires

"Runs when the user is shown a permission dialog."
It matches on tool name with the same matcher values as `PreToolUse`, so a plan-review hook uses `"matcher": "ExitPlanMode"`.
Added in Claude Code v2.0.45; permission-update processing added in v2.0.54 (https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).

### stdin payload

The hook receives a JSON object on stdin.
`PermissionRequest` gets `tool_name` and `tool_input` like `PreToolUse`, but without `tool_use_id`, plus an optional `permission_suggestions` array holding the "always allow" options the dialog would show.
Doc example (with `tool_name`/`tool_input` swapped here for the plan case):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-....jsonl",
  "cwd": "/Users/...",
  "permission_mode": "plan",
  "hook_event_name": "PermissionRequest",
  "tool_name": "ExitPlanMode",
  "tool_input": {
    "plan": "## Refactor auth\n1. Extract...",
    "planFilePath": "/Users/.../plans/refactor-auth.md"
  },
  "permission_suggestions": [
    {
      "type": "addRules",
      "rules": [{ "toolName": "ExitPlanMode" }],
      "behavior": "allow",
      "destination": "localSettings"
    }
  ]
}
```

Common input fields on all hook events include `session_id`, `transcript_path`, `cwd`, `permission_mode`, and `hook_event_name`.
The docs warn that `transcript_path` is written asynchronously and may lag the in-memory conversation.

### Response format (decision control)

Exit 0 and print JSON to stdout.
The decision lives in `hookSpecificOutput.decision` (this event does not use the top-level `decision: "block"` pattern of PostToolUse/Stop):

| Field | Description (quoted/condensed from the reference) |
| :--- | :--- |
| `behavior` | `"allow"` grants the permission, `"deny"` denies it. Deny and ask rules are still evaluated, so `"allow"` doesn't override a matching deny rule |
| `updatedInput` | For `"allow"` only: replaces the entire tool input object; re-evaluated against deny and ask rules |
| `updatedPermissions` | For `"allow"` only: array of permission update entries (add rules, set mode, etc.) |
| `message` | For `"deny"` only: tells Claude why the permission was denied |
| `interrupt` | For `"deny"` only: if `true`, stops Claude |

Allow:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

Deny with feedback:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Plan rejected: step 3 must include a migration rollback. Revise and re-present."
    }
  }
}
```

How feedback reaches the model: the `message` field is delivered to Claude as the reason the permission was denied.
With `interrupt` absent or `false`, Claude keeps going in plan mode and can revise the plan; with `interrupt: true` the turn stops.
Exiting 0 with no stdout (or an empty JSON object) means "no decision" and the normal permission dialog is shown to the user.

### Exit codes

From the exit-code sections of the reference:

- Exit 0: Claude Code parses stdout for JSON output fields. JSON is only processed on exit 0.
- Exit 2: blocking error. Stdout/JSON is ignored; stderr text is fed back to Claude. For `PermissionRequest` the per-event table says exit 2 "Denies the permission".
- Any other exit code: non-blocking error; execution continues (the docs explicitly warn that exit 1 does NOT block).

### Timeout and blocking behavior

- Hooks are synchronous by default: a command hook without `async: true` blocks the pending action until it exits. All matching hooks for an event run in parallel, and identical handlers are deduplicated.
- Default timeout is 600 seconds for `command`, `http`, and `mcp_tool` hooks (30 for `prompt`, 60 for `agent`), configurable per hook entry via `timeout` (seconds).
- The `timeout` field is documented as "Seconds before canceling."
  The docs do not spell out the post-timeout outcome specifically for `PermissionRequest`; since a canceled hook produces no decision, the expected behavior is fall-through to the normal permission dialog (medium confidence - inferred from the "no decision" rule, not explicitly stated).
- `async: true` exists but is useless for a decision gate: an async hook cannot return a decision that blocks the pending dialog.

Practical consequence for an external reviewer process: a synchronous `PermissionRequest` command hook can hold the decision open for up to its configured timeout while an external process (editor, web UI, another human) reviews the plan, then print the allow/deny JSON.

### Interactive-only caveat

From the hooks guide (https://code.claude.com/docs/en/hooks-guide, "Limitations"):

> `PermissionRequest` hooks don't fire in non-interactive mode with the `-p` flag. Use `PreToolUse` hooks for automated permission decisions.

## 3. PreToolUse as the headless-compatible surface

Source: https://code.claude.com/docs/en/hooks ("PreToolUse decision control").

`PreToolUse` matches `ExitPlanMode` by name and returns:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Plan rejected: missing test coverage for the migration."
  }
}
```

- `permissionDecision`: `"allow"`, `"deny"`, `"ask"`, or `"defer"`.
- `permissionDecisionReason`: for `"deny"` it is shown to Claude (this is the feedback channel); for `"allow"`/`"ask"` it is shown to the user only.
- Precedence when multiple hooks disagree: `deny` > `defer` > `ask` > `allow`.
- Deprecated top-level `decision`/`reason` (`"approve"`/`"block"`) still map to allow/deny but should not be used.

Headless specifics, quoted from the reference:

> `AskUserQuestion` and `ExitPlanMode` require user interaction and normally block in non-interactive mode with the `-p` flag.
> Returning `permissionDecision: "allow"` together with `updatedInput` satisfies that requirement ... Returning `"allow"` alone is not sufficient for these tools.

So in `-p` mode an adapter must echo the input back (e.g. the original `plan`/`planFilePath`) inside `updatedInput` alongside `"allow"`.

`"defer"` (honored only in `-p` mode) is the mechanism for pausing at the tool call and resuming later: the process exits with `stop_reason: "tool_deferred"` and a `deferred_tool_use` payload carrying the tool `id`, `name`, and `input`; the caller resumes with `claude -p --resume <session-id>` and the hook fires again.
There is no timeout or retry limit on a deferred session beyond the 30-day `cleanupPeriodDays` retention sweep.
`"defer"` only works when Claude made a single tool call in the turn.

## 4. Hook configuration snippet

From the hooks guide's auto-approval example (https://code.claude.com/docs/en/hooks-guide), adapted shape - settings file (`~/.claude/settings.json`, `.claude/settings.json`, or `.claude/settings.local.json`):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "my-plan-reviewer",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

Notes from the guide:

- Keep the matcher narrow; `.*` or an empty matcher would auto-answer every permission prompt.
- When a hook allows `ExitPlanMode`, "Claude Code exits plan mode and restores whatever permission mode was active before you entered plan mode" and the transcript shows "Allowed by PermissionRequest hook".
- The hook path "always keeps the current conversation: it can't clear context and start a fresh implementation session the way the dialog can."

## 5. Shipping hooks in a plugin

Source: https://code.claude.com/docs/en/plugins-reference ("Hooks" section).

- Location: `hooks/hooks.json` at the plugin root, or inline under a `"hooks"` key in `.claude-plugin/plugin.json` (which may also point at custom paths, e.g. `"hooks": "./config/hooks.json"`).
- Format: identical event/matcher/hooks structure as user-defined hooks; `PermissionRequest` and `PreToolUse` are both supported plugin events.
- Bundled scripts are referenced via `${CLAUDE_PLUGIN_ROOT}`, e.g. `"command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/review-plan.sh"`; the docs recommend exec form with `args` so paths are passed unquoted.
- Hook types available: `command`, `http` (POSTs the event JSON to a URL), `mcp_tool`, `prompt`, and `agent`.
- `${CLAUDE_PLUGIN_ROOT}` changes when the plugin updates; a mid-session update keeps hooks on the old path until `/reload-plugins` or restart.
- Scaffolding: `claude plugin init my-plugin --with hooks` generates a `hooks/hooks.json` sample.
- Plugins are distributed through marketplaces (a repo with `.claude-plugin/marketplace.json` listing plugins); the plugin directory layout keeps `hooks/` at the plugin root, not inside `.claude-plugin/`.

HTTP hooks matter for an external-service design: non-2xx responses, connection failures, and timeouts are all non-blocking errors, so an HTTP hook must return 2xx with the decision JSON in the body to deny.

## 6. Open questions

- Post-timeout behavior for a `PermissionRequest` hook is not explicitly documented; fall-through to the normal dialog is inferred (medium confidence). Worth an empirical test.
- The docs don't state whether a `PermissionRequest` `deny` on `ExitPlanMode` keeps the session in plan mode (high confidence that it does, since the tool never ran, but not stated verbatim).
- Whether the user sees any progress indication while a synchronous `PermissionRequest` hook holds the dialog is not specified in the reference; needs a live check.
- `permission_suggestions` shape for `ExitPlanMode` specifically (vs. the documented Bash example) should be captured from a real payload.
