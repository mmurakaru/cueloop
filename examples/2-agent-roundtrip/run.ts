#!/usr/bin/env bun
/**
 * Example 2: the full agent round-trip in two terminals.
 *   Terminal A: bun run examples/2-agent-roundtrip/run.ts agent
 *   Terminal B: cueloop            (or: bun run packages/cli/src/main.ts)
 * The "agent" submits a plan through the Claude Code hook contract and
 * blocks; review it in terminal B; the verdict prints in terminal A.
 */

import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "..", "packages", "adapters", "claude-code", "hook.ts");

const event = {
  hook_event_name: "PreToolUse",
  session_id: `example-${Date.now().toString(36)}`,
  cwd: process.cwd(),
  tool_name: "ExitPlanMode",
  tool_input: {
    plan: "# Example Plan\n\n## Goal\n\nProve the round-trip works end to end.\n",
  },
};

console.log("submitting the plan and blocking on your verdict…");
const proc = Bun.spawn([process.execPath, "run", HOOK], {
  stdin: new TextEncoder().encode(JSON.stringify(event)),
  stdout: "pipe",
  env: { ...process.env, CUELOOP_WAIT_MS: "600000" },
});
console.log(await new Response(proc.stdout).text());
