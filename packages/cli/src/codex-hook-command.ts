import { CodexHookInputSchema, runCodexHook } from "@cueloop/adapters/codex/hook";
import * as v from "valibot";

/** Read one Codex lifecycle event and return its optional tool rewrite. */
export async function codexHookCommand(): Promise<number> {
  try {
    const input = v.parse(
      CodexHookInputSchema,
      JSON.parse(await new Response(Bun.stdin.stream()).text()),
    );
    const output = runCodexHook(input);

    if (output) console.log(JSON.stringify(output));

    return 0;
  } catch (error) {
    console.error(`cueloop Codex hook failed: ${String(error)}`);

    return 1;
  }
}
