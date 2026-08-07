/** Shared test helpers: run the real CLI as a black box in an isolated home. */

import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "packages", "cli", "src", "main.ts");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  home: string,
  args: string[],
  stdin?: string,
  env?: Record<string, string>,
): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, "run", CLI_ENTRY, ...args], {
    env: { ...process.env, CUELOOP_HOME: home, CUELOOP_IDLE_EXIT_MS: "0", ...env },
    stdin: stdin !== undefined ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export function cliJson<T = Record<string, unknown>>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}
