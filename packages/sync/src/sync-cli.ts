import { serveSyncApplication } from "./sync-server.ts";
import { loadSyncApplication } from "./sync-application.ts";

const SYNC_HELP = `General-purpose sync for terminals

Usage: cueloop-sync <serve|connect> --application <module> [options]

  serve     Run the application's authenticated query and mutation authority
  connect   Run the application's sync client

Serve options: --host <address> --port <number>
The authority requires a configured PostgreSQL database and Zero cache service.
The application module exports syncApplication with fetch, optional connect, and close.
Use environment variables for credentials.
`;

function syncFlag(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);

  if (index < 0) return undefined;

  const value = arguments_[index + 1];

  if (!value || value.startsWith("--"))
    throw new Error(`Sync command requires a value for ${name}`);

  return value;
}

export async function runSyncCli(arguments_: string[]): Promise<number> {
  if (arguments_.length === 0 || arguments_.includes("--help")) {
    process.stdout.write(SYNC_HELP);

    return 0;
  }

  const command = arguments_[0];

  if (command !== "serve" && command !== "connect") {
    throw new Error(`Sync command is unknown: ${command}`);
  }

  const applicationPath = syncFlag(arguments_, "--application");

  if (!applicationPath) throw new Error("Sync command requires --application <module>");

  const application = await loadSyncApplication(applicationPath);

  if (command === "connect") {
    try {
      if (!application.connect) throw new Error("Sync application does not provide a client");

      await application.connect(arguments_.slice(1));
    } finally {
      await application.close?.();
    }

    return 0;
  }

  const port = Number(syncFlag(arguments_, "--port") ?? "4849");

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Sync authority port must be an integer between 0 and 65535");
  }

  const server = await serveSyncApplication(application, {
    host: syncFlag(arguments_, "--host"),
    port,
  });

  const stopped = new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  process.stdout.write(JSON.stringify({ event: "sync.authority.ready", port: server.port }) + "\n");
  await stopped;
  await server.close();

  return 0;
}
