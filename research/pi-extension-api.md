# Research: pi extension API for a blocking review tool

Resolves [#5](https://github.com/mmurakaru/cueloop/issues/5).

## Sources

All claims verified against the pi source repo at commit `5bc1c2c0a6f07e00e8c240304182f213ab8d311f`.
The repo formerly known as `badlogic/pi-mono` now redirects to [`earendil-works/pi`](https://github.com/earendil-works/pi) (confirmed via the GitHub API: `full_name` is `earendil-works/pi`).
The npm package is [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (v0.82.1 at time of research).
Docs are hosted at [pi.dev/docs/latest](https://pi.dev/docs/latest); the pages cited below also live in the repo under `packages/coding-agent/docs/`.

- Extensions guide: [pi.dev/docs/latest/extensions](https://pi.dev/docs/latest/extensions) / [`packages/coding-agent/docs/extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- Packaging guide: [pi.dev/docs/latest/packages](https://pi.dev/docs/latest/packages) / [`packages/coding-agent/docs/packages.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- Type definitions: [`packages/coding-agent/src/core/extensions/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- Blocking interactive tool example: [`packages/coding-agent/examples/extensions/question.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/question.ts)

## Answer summary

Yes - a pi extension can register a tool whose `execute()` blocks on an external verdict.
`execute()` returns a `Promise`, pi awaits it inside the agent turn, and the loop does not continue until it resolves.
A long-running external HTTP request (long-poll to a review server, or a local HTTP server the tool starts and awaits) is exactly how the shipped `question.ts` example blocks on user input, just with a network wait instead of a TUI wait.
Cancellation arrives via the `AbortSignal` parameter (Esc in the TUI aborts the turn), so the fetch should be passed `signal`.

## ExtensionAPI surface

An extension is a TypeScript module exporting a default factory that receives `ExtensionAPI` (`extensions.md`, "Writing an Extension").
Extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript runs without a build step.

Key methods (`types.ts`, `interface ExtensionAPI`, line 1179):

- `pi.registerTool(definition)` - register an LLM-callable tool; works at load time or later (e.g. inside `session_start`), refreshed into the live session without `/reload`.
- `pi.on(event, handler)` - lifecycle hooks: `session_start`, `before_agent_start`, `turn_start/turn_end`, `tool_call`, `tool_result`, `context`, `before_provider_request`, `input`, etc. (`extensions.md`, "Events").
- `pi.registerCommand(name, opts)` / `pi.registerShortcut(...)` / `pi.registerFlag(...)`.
- `pi.sendMessage(msg, opts)` / `pi.sendUserMessage(content, opts)` - inject messages into the loop.
- `pi.appendEntry(customType, data)` - persist extension state in the session without touching LLM context.
- `pi.setActiveTools(names)` / `pi.getActiveTools()` / `pi.getAllTools()`.

### Tool definition signature

From `types.ts` lines 443-492:

```typescript
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;        // one-liner in system prompt "Available tools"
  promptGuidelines?: string[];   // bullets appended to system prompt while active
  parameters: TParams;           // TypeBox schema
  executionMode?: "sequential" | "parallel";
  prepareArguments?: (args: unknown) => Static<TParams>;
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
  renderCall?(args, theme, context): Component;
  renderResult?(result, options, theme, context): Component;
}
```

Relevant semantics (`extensions.md`, "Custom Tools"):

- `execute()` is awaited; the agent turn blocks until it returns. The shipped `question.ts` example blocks indefinitely on custom TUI input and sets `executionMode: "sequential"` so it does not run concurrently with sibling tool calls (tools run in parallel by default).
- `onUpdate?.({ content, details })` streams progress into the TUI while blocked ("Waiting for review...").
- `signal` is the turn abort signal; pass it to `fetch()` so Esc cancels the wait.
- Returning a value never sets the error flag; throw from `execute()` to produce `isError: true` on the result ("Signaling errors").
- `content: [{ type: "text", text }]` goes to the LLM; `details` is for rendering and state reconstruction.
- `terminate: true` on the result asks pi to skip the automatic follow-up LLM call after the tool batch ("Early termination") - useful if a rejected review should end the run instead of letting the model react.
- Output must be truncated (50KB / 2000 lines guidance) via exported `truncateHead`/`truncateTail` helpers.

### Awaiting a long-running external HTTP request

Nothing in the tool runner imposes a timeout on `execute()`; the docs' interactive examples (`question.ts`, `questionnaire.ts`) block for arbitrarily long on user input.
An HTTP long-poll works the same way:

```typescript
const response = await fetch(`${reviewServerUrl}/verdict/${reviewId}`, { signal });
```

`ctx.signal` is documented as the mechanism that lets Esc "cancel model calls, `fetch()`, and other abort-aware operations started by the extension" (`extensions.md`, "ctx.signal"); inside `execute()` the equivalent signal is the third parameter.
`ctx.ui` (select/confirm/input/notify/custom) is also available inside `execute()` for an in-terminal fallback; guard with `ctx.hasUI` / `ctx.mode` since print/JSON modes have no UI (`extensions.md`, "Mode Behavior").

## Mutating the loop on denial

Options, all documented in `extensions.md`:

1. Tool result content (simplest): return the verdict text ("Changes requested: ...") as `content`; the model reacts in the same run. Throwing instead marks the result `isError: true`.
2. `pi.on("tool_call", handler)` returning `{ block: true, reason }` (type `ToolCallEventResult`, `types.ts` line 1065) blocks any tool before execution - usable to gate `edit`/`write`/`bash` while a review is pending. `event.input` is mutable in place for argument patching.
3. `pi.sendMessage({ customType, content, display }, { deliverAs, triggerTurn })` injects a custom message that participates in LLM context. `deliverAs` is `"steer"` (delivered after the current assistant turn's tool calls, before the next LLM call), `"followUp"` (after the agent finishes), or `"nextTurn"`; `triggerTurn: true` starts a run if idle - so an asynchronous denial arriving later can wake the agent.
4. `pi.sendUserMessage(content, { deliverAs })` injects a message as if the user typed it; always triggers a turn when idle.
5. `pi.on("before_agent_start")` can return `{ message }` to inject persistent context and/or replace the system prompt for the turn; `pi.on("context")` can rewrite the message array before each LLM call.
6. `pi.on("tool_result")` can rewrite any tool's result (middleware-chained patches of `content`/`details`/`isError`).

## Sketch: submit_for_review tool

```typescript
// .pi/extensions/submit-for-review.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const REVIEW_SERVER = process.env.REVIEW_SERVER_URL ?? "http://127.0.0.1:4877";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "submit_for_review",
    label: "Submit for review",
    description:
      "Submit the current diff for human review and wait for the verdict. " +
      "Returns approval, or rejection with reviewer comments to address.",
    promptSnippet: "Submit completed work for human review before finishing",
    promptGuidelines: ["Call submit_for_review after completing the requested change and before summarizing."],
    parameters: Type.Object({
      summary: Type.String({ description: "One-paragraph summary of the change under review" }),
    }),
    executionMode: "sequential", // do not run alongside sibling tool calls

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const submit = await fetch(`${REVIEW_SERVER}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: ctx.cwd, summary: params.summary }),
        signal,
      });
      const { id, url } = (await submit.json()) as { id: string; url: string };

      onUpdate?.({ content: [{ type: "text", text: `Waiting for review: ${url}` }] });
      ctx.ui.setStatus("review", "Awaiting reviewer verdict...");

      try {
        // Long-poll until the reviewer decides; Esc aborts via `signal`.
        const verdictResponse = await fetch(`${REVIEW_SERVER}/reviews/${id}/verdict?wait=true`, { signal });
        const verdict = (await verdictResponse.json()) as {
          decision: "approve" | "deny";
          comments: string[];
        };

        if (verdict.decision === "deny") {
          // The verdict text is the tool result: the model sees the comments
          // and continues the same run to address them.
          return {
            content: [{
              type: "text",
              text: `Changes requested:\n${verdict.comments.map((c) => `- ${c}`).join("\n")}`,
            }],
            details: { id, verdict },
          };
        }

        return {
          content: [{ type: "text", text: "Approved by reviewer." }],
          details: { id, verdict },
          terminate: true, // skip the follow-up LLM call; the run is done
        };
      } finally {
        ctx.ui.setStatus("review", undefined);
      }
    },
  });
}
```

A stricter variant also registers a `tool_call` hook that returns `{ block: true, reason: "Review pending" }` for `edit`/`write`/`bash` while a submitted review is unresolved, and uses `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` to push a late-arriving denial into an idle session.

## Packaging and installation

From `packages.md` and `extensions.md` ("Extension Locations"):

- Auto-discovery: `~/.pi/agent/extensions/*.ts` or `*/index.ts` (global), `.pi/extensions/*.ts` or `*/index.ts` (project-local, loaded only after the project is trusted). Hot-reloadable with `/reload`.
- Ad hoc: `pi -e ./extension.ts` (also accepts `npm:`/`git:` specs for a temporary install).
- Distribution: `pi install npm:@scope/pkg@1.0.0`, `pi install git:github.com/user/repo@v1`, or local paths; `pi remove` / `pi list` / `pi update --extensions`. `-l` writes to project settings (`.pi/settings.json`) so a team install happens automatically on trusted startup.
- A package declares resources in `package.json` under the `pi` key, e.g. `"pi": { "extensions": ["./src/index.ts"] }`, and should carry the `pi-package` keyword. npm deps go in `dependencies` (installs use `--omit=dev`).
- Settings-based loading: `"packages": ["npm:...", "git:..."]` and `"extensions": ["/path"]` arrays in `settings.json`.
- Security note from the docs: extensions run with full system permissions; only install trusted sources.

## Open questions

- No explicit statement of a tool-execution timeout was found in the docs; the interactive examples imply unbounded waits, but very long (multi-hour) awaits were not tested against provider/HTTP keep-alive behavior in RPC or print modes.
- In `print` / `json` modes there is no UI and no user at the terminal; a review tool must rely purely on the external server there (`ctx.hasUI === false`).
- Whether pi persists and resumes an in-flight tool call across a process restart: sessions store tool results, but a blocked `execute()` does not survive a restart, so a review pending at exit would need re-submission logic (e.g. reconciling in `session_start` from `details` stored in prior tool results).
