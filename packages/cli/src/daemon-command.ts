/** Compose the local daemon with its installed harness adapters at the CLI boundary. */
export async function daemonCommand(argv: string[]): Promise<number> {
  const { DaemonServer } = await import("@cueloop/daemon");
  // Explicit foreground never idle-exits; --autostart (a re-exec from the client)
  // takes the normal idle-exit, matching the source main.ts entry.
  const envIdle = process.env.CUELOOP_IDLE_EXIT_MS;
  let idleExitMs: number | undefined = 0;

  if (argv.includes("--autostart")) idleExitMs = envIdle ? Number(envIdle) : undefined;
  const { configuredAgentHarness, threadAgentEnabled } = await import("./agent-harness");
  const server = new DaemonServer({
    idleExitMs,
    threadAgent: {
      enabled: true,
      enabledForThread: (thread) => threadAgentEnabled(thread.workspace.repoRoot),
      adapter: configuredAgentHarness(),
    },
  });
  const path = server.start();

  if (path === null) {
    console.error("a cueloop daemon already owns this home - nothing to do");

    return 1;
  }
  console.log(`cueloop daemon (foreground) on ${path}`);
  const stop = () => {
    server.stop();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", () => server.stop());
  await new Promise(() => {}); // run until signalled

  return 0;
}
