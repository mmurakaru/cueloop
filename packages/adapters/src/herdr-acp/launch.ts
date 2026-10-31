import { spawn, spawnSync } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import type { HcInstall } from "./detect";

export interface RelayLaunch {
  socketPath: string;
  transcriptPath: string;
  cwd: string;
  command: string[];
  name: string;
  launch: "hc" | "process";
  hc?: HcInstall;
  hcSession: string;
  xdgRuntimeDir?: string;
  env: NodeJS.ProcessEnv;
}

/** Start the relay if this socket is not already accepting clients. */
export async function ensureRelay(options: RelayLaunch): Promise<void> {
  if (await socketAccepts(options.socketPath)) return;

  const argv = relayCommand(options);
  const env = relayEnvironment(options);

  if (options.launch === "hc") await runHc(options, argv, env);
  else spawnDetached(argv, env, `${options.socketPath}.log`);

  const ready = await waitForSocket(options.socketPath, 5_000);

  if (!ready) throw new Error("herdr ACP relay did not open its socket");
}

export function relayCommand(
  options: Pick<RelayLaunch, "socketPath" | "transcriptPath" | "cwd" | "command">,
): string[] {
  const script = fileURLToPath(new URL("./relay.ts", import.meta.url));
  const compiled =
    script.includes("$bunfs") || script.includes("~BUN") || script.includes("%7EBUN");
  const head = compiled ? [process.execPath, "herdr-acp-relay"] : [process.execPath, script];

  return [
    ...head,
    "--socket",
    options.socketPath,
    "--transcript",
    options.transcriptPath,
    "--cwd",
    options.cwd,
    "--",
    ...options.command,
  ];
}

function relayEnvironment(options: RelayLaunch): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...options.env, HC_SESSION: options.hcSession };

  if (options.xdgRuntimeDir) env.XDG_RUNTIME_DIR = options.xdgRuntimeDir;

  return env;
}

async function runHc(options: RelayLaunch, argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (!options.hc) throw new Error("herdr ACP launch needs an hc binary");

  const result = spawnSync(
    options.hc.binary,
    ["run", "--bg", "--name", options.name, "--cwd", options.cwd, "--", ...argv],
    { env, encoding: "utf8", timeout: 10_000 },
  );

  if (result.status === 0) return;

  if (await socketAccepts(options.socketPath)) return;

  throw new Error(result.stderr || result.stdout || `hc run exited ${result.status}`);
}

function spawnDetached(argv: string[], env: NodeJS.ProcessEnv, logPath: string): void {
  const log = openSync(logPath, "a", 0o600);
  const child = spawn(argv[0]!, argv.slice(1), {
    detached: true,
    stdio: ["ignore", log, log],
    env,
  });

  child.unref();
  closeSync(log);
}

function waitForSocket(socketPath: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();

  return new Promise((resolve) => {
    const attempt = () => {
      void socketAccepts(socketPath).then((ready) => {
        if (ready) {
          resolve(true);

          return;
        }

        if (Date.now() - started > timeoutMs) {
          resolve(false);

          return;
        }

        setTimeout(attempt, 20);
      });
    };

    attempt();
  });
}

export function socketAccepts(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);

    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
