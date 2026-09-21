import * as v from "valibot";
import { cueloopHome } from "@cueloop/daemon/paths";
import { createCodexSessionRegistry } from "./session-registry";

export const CodexHookInputSchema = v.object({
  hook_event_name: v.picklist(["SessionStart", "SessionEnd", "PreToolUse"]),
  session_id: v.pipe(v.string(), v.minLength(1)),
  cwd: v.string(),
  tool_name: v.optional(v.string()),
  tool_input: v.optional(v.record(v.string(), v.unknown())),
});

/** Bind Codex's native session ID and add it to cueloop MCP tool arguments. */
export function runCodexHook(
  input: v.InferOutput<typeof CodexHookInputSchema>,
  home = cueloopHome(),
): object | undefined {
  const sessions = createCodexSessionRegistry(home);

  if (input.hook_event_name === "SessionStart") {
    sessions.activate(input.session_id);

    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "For cueloop skills, call the cueloop open_thread MCP tool with the named workflow. The plugin hook supplies harnessSessionId and cwd. For refine, call refine_corpus first.",
      },
    };
  }
  if (input.hook_event_name === "SessionEnd") {
    sessions.deactivate(input.session_id);

    return;
  }
  if (input.tool_name !== "mcp__cueloop__open_thread") return;

  sessions.activate(input.session_id);

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        ...input.tool_input,
        harnessSessionId: input.session_id,
        cwd: input.cwd,
      },
    },
  };
}
