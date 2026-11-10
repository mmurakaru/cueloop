import type { SyncTextEditorSession } from "./sync-text-session.ts";
import {
  serveSyncApplication,
  parseSyncRequestByteBudget,
  type SyncApplication,
  type SyncClientOutcome,
} from "./sync-server.ts";
import { loadSyncApplication } from "./sync-application.ts";

const SYNC_HELP = `General-purpose sync for terminals

Usage: cueloop-sync <serve|connect|owner> --application <module> [options]

  serve     Run the application's authenticated query and mutation authority
  connect   Run the application's sync client
  owner     Recover and execute accepted requests through an application integration
  database  Back up, restore, fence, migrate, and inspect a PostgreSQL authority
  workspace Transfer a workspace between PostgreSQL authorities

Serve options: --host <address> --port <number> --public-origin <url> --maximum-request-bytes <number>
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

function syncAuthorityOptions(arguments_: string[]) {
  const port = Number(syncFlag(arguments_, "--port") ?? "4849");

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Sync authority port must be an integer between 0 and 65535");
  }

  return {
    port,
    maximumRequestBytes: parseSyncRequestByteBudget(
      Number(syncFlag(arguments_, "--maximum-request-bytes") ?? "1048576"),
    ),
    host: syncFlag(arguments_, "--host"),
    publicOrigin: syncFlag(arguments_, "--public-origin"),
  };
}

async function connectSyncApplication(
  application: SyncApplication,
  clientArguments: string[],
  method: "connect" | "execute" = "connect",
): Promise<number> {
  let outcome: SyncClientOutcome | void;

  try {
    const run = application[method];

    if (!run) throw new Error(`Sync application does not provide ${method}`);

    const applicationIndex = clientArguments.indexOf("--application");

    clientArguments.splice(applicationIndex, 2);
    outcome = await run(clientArguments);
  } finally {
    await application.close?.();
  }

  return outcome?.status === "interrupted" ? (outcome.signal === "SIGINT" ? 130 : 143) : 0;
}

async function editSyncApplication(
  application: SyncApplication,
  clientArguments: string[],
  render: (session: SyncTextEditorSession) => Promise<void | SyncClientOutcome>,
): Promise<number> {
  try {
    if (!application.openText) throw new Error("Sync application does not provide a text editor");

    const applicationIndex = clientArguments.indexOf("--application");

    clientArguments.splice(applicationIndex, 2);
    const session = await application.openText(clientArguments);

    try {
      const outcome = await render(session);

      return outcome?.status === "interrupted" ? (outcome.signal === "SIGINT" ? 130 : 143) : 0;
    } finally {
      await session.close();
    }
  } finally {
    await application.close?.();
  }
}

export async function runSyncCli(
  arguments_: string[],
  options: {
    renderTextEditor?: (session: SyncTextEditorSession) => Promise<void | SyncClientOutcome>;
  } = {},
): Promise<number> {
  if (arguments_[0] === "database") {
    const { runSyncDatabaseCli } = await import("./sync-database-cli.ts");

    return runSyncDatabaseCli(arguments_.slice(1));
  }

  if (arguments_[0] === "workspace") {
    const { runSyncWorkspaceCli } = await import("./sync-workspace-cli.ts");

    return runSyncWorkspaceCli(arguments_.slice(1));
  }

  if (arguments_.length === 0 || arguments_.includes("--help")) {
    process.stdout.write(
      SYNC_HELP +
        (options.renderTextEditor
          ? "  edit      Edit shared plan text with explicit submission\n"
          : ""),
    );

    return 0;
  }

  const command = arguments_[0];

  if (
    command !== "serve" &&
    command !== "connect" &&
    command !== "owner" &&
    (command !== "edit" || !options.renderTextEditor)
  ) {
    throw new Error(`Sync command is unknown: ${command}`);
  }

  const applicationPath = syncFlag(arguments_, "--application");

  if (!applicationPath) throw new Error("Sync command requires --application <module>");

  const authorityOptions = command === "serve" ? syncAuthorityOptions(arguments_) : {};

  const application = await loadSyncApplication(applicationPath);

  if (command === "edit" && options.renderTextEditor) {
    return editSyncApplication(application, arguments_.slice(1), options.renderTextEditor);
  }

  if (command === "connect") {
    return connectSyncApplication(application, arguments_.slice(1));
  }

  if (command === "owner") {
    return connectSyncApplication(application, arguments_.slice(1), "execute");
  }

  let server: Awaited<ReturnType<typeof serveSyncApplication>>;

  try {
    server = await serveSyncApplication(application, authorityOptions);
  } catch (error) {
    await application.close?.();

    throw error;
  }

  const stopped = new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  process.stdout.write(
    JSON.stringify({ event: "sync.authority.listening", port: server.port }) + "\n",
  );
  await stopped;
  await server.close();

  return 0;
}
