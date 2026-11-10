import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

export interface SyncPostgresTools {
  dump?: readonly string[];
  restore?: readonly string[];
}

/** PostgreSQL credentials travel through the environment; subprocess diagnostics never disclose them. */
export async function runSyncPostgresTool(options: {
  command: readonly string[];
  arguments: string[];
  databaseURL: string;
  inputPath?: string;
  outputPath?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const [executable, ...prefix] = options.command;

  if (!executable) throw new Error("Sync PostgreSQL tool executable is required");

  const input = options.inputPath ? await open(options.inputPath, "r") : undefined;
  let output: Awaited<ReturnType<typeof open>> | undefined;

  try {
    output = options.outputPath ? await open(options.outputPath, "wx", 0o600) : undefined;
    options.signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [...prefix, ...options.arguments], {
        env: {
          ...process.env,
          PGDATABASE: options.databaseURL,
          PGAPPNAME: "cueloop-sync-operator",
        },
        stdio: [input?.fd ?? "ignore", output?.fd ?? "ignore", "ignore"],
      });
      const abort = () => {
        child.kill("SIGTERM");
      };

      options.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", () => reject(new Error("Sync PostgreSQL tool could not start")));
      child.once("close", (code) => {
        options.signal?.removeEventListener("abort", abort);

        if (options.signal?.aborted) reject(options.signal.reason);
        else if (code === 0) resolve();
        else
          reject(
            new Error(
              "Sync PostgreSQL tool failed; verify tool version, credentials, and database prerequisites",
            ),
          );
      });

      if (options.signal?.aborted) abort();
    });
    await output?.sync();
  } finally {
    await input?.close();
    await output?.close();
  }
}
