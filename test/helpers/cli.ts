/** Shared test helpers: run the real CLI as a black box in an isolated home. */

import { join } from "node:path";
import { hermeticCueloopEnvironment } from "./env";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "packages", "cli", "src", "main.ts");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function cliJson<T = object>(result: CliResult): T {
  return JSON.parse(result.stdout);
}

export async function runCli(
  home: string,
  args: string[],
  stdin?: string,
  env?: Record<string, string>,
  cwd = process.cwd(),
): Promise<CliResult> {
  const binary = env?.CUELOOP_TEST_EXECUTABLE ?? process.env.CUELOOP_TEST_EXECUTABLE;
  const command = binary ? [binary, ...args] : [process.execPath, "run", CLI_ENTRY, ...args];
  const proc = Bun.spawn(command, {
    cwd,
    env: hermeticCueloopEnvironment(home, env),
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
