import { OwnerAgentRelay } from "@cueloop/adapters/owner-agent-relay";
/** Compose the local daemon with its installed harness adapters at the CLI boundary. */
export async function daemonCommand(argv: string[]): Promise<number> {
  const { DaemonServer } = await import("@cueloop/daemon");
  // Explicit foreground never idle-exits; --autostart (a re-exec from the client)
  // takes the normal idle-exit, matching the source main.ts entry.
  const envIdle = process.env.CUELOOP_IDLE_EXIT_MS;
  let idleExitMs: number | undefined = 0;

  if (argv.includes("--autostart")) idleExitMs = envIdle ? Number(envIdle) : undefined;

  const { configuredAgentHarnessId, installedAgentHarnesses, threadAgentEnabled } =
    await import("./agent-harness");
  const adapters = installedAgentHarnesses();
  let relay: OwnerAgentRelay | undefined;
  const server = new DaemonServer({
    onEvent: (event) => {
      relay?.notify(event);

      if (event.event !== "agent.updated") relay?.update(server.core.sessionList());
    },
    idleExitMs,
    agentHarnessDefault: () => configuredAgentHarnessId(),
    threadAgent: {
      enabled: true,
      enabledForThread: (thread) => threadAgentEnabled(thread.workspace.repoRoot),
      adapter: adapters[configuredAgentHarnessId()],
      adapters,
      defaultHarnessForThread: (thread) =>
        adapters[configuredAgentHarnessId(thread.workspace.repoRoot)],
    },
  });
  const path = server.start();

  if (path === null) {
    console.error("a cueloop daemon already owns this home - nothing to do");

    return 1;
  }

  server.resumeAgents();
  relay = new OwnerAgentRelay({
    home: server.home,
    enabled: (thread) => threadAgentEnabled(thread.workspace.repoRoot),
    onError: (error) => console.error("[agent relay]", error),
  });
  relay.update(server.core.sessionList());
  console.log(`cueloop daemon (foreground) on ${path}`);
  const stop = async () => {
    relay?.stop();
    await server.shutdown();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", () => {
    relay?.stop();
    server.stop();
  });
  await new Promise(() => {}); // run until signalled

  return 0;
}
