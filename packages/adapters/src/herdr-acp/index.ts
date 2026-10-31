import { spawn } from "node:child_process";
import { createHerdrAcp, type HerdrAcpIntegration, type HerdrAcpOptions } from "./binding";
import { detectHc, type HcInstall } from "./detect";
import { herdrSessionName } from "./names";

export { detectHc, findOnPath } from "./detect";
export { parseHcVersion, hcVersionAtLeast, MINIMUM_HC_VERSION } from "./names";
export { runHerdrAcpRelay } from "./relay";
export { createHerdrAcp, type HerdrAcpIntegration, type HerdrAcpOptions } from "./binding";

const UNAVAILABLE =
  "herdr-core ACP is enabled, but hc 0.1.15 or newer is not installed. Agent tasks stay tied to this daemon.";

/** Turn the experimental flag into a backend, or leave the caller on the child-process path. */
export function resolveHerdrAcp(options: {
  enabled: boolean;
  home: string;
  command: string[];
  env?: NodeJS.ProcessEnv;
  detect?: () => HcInstall | undefined;
  launch?: HerdrAcpOptions["launch"];
  warn?: (message: string) => void;
  hcSession?: string;
  xdgRuntimeDir?: string;
  xdgStateHome?: string;
  xdgConfigHome?: string;
}): HerdrAcpIntegration | undefined {
  if (!options.enabled) return undefined;

  if (options.launch === "process") {
    return createHerdrAcp({
      home: options.home,
      command: options.command,
      launch: "process",
      env: options.env,
      hcSession: options.hcSession,
      xdgRuntimeDir: options.xdgRuntimeDir,
      xdgStateHome: options.xdgStateHome,
      xdgConfigHome: options.xdgConfigHome,
    });
  }

  const found = (options.detect ?? (() => detectHc(options.env)))();

  if (!found) {
    (options.warn ?? ((message) => console.error(message)))(UNAVAILABLE);

    return undefined;
  }

  const env = options.env ?? process.env;

  warmHerdrCore(found, env, herdrSessionName(env, options.hcSession));

  return createHerdrAcp({
    home: options.home,
    command: options.command,
    launch: "hc",
    hc: found,
    env,
    hcSession: options.hcSession,
    xdgRuntimeDir: options.xdgRuntimeDir,
    xdgStateHome: options.xdgStateHome,
    xdgConfigHome: options.xdgConfigHome,
  });
}

/** Overlap core startup with the rest of daemon boot. The first prompt still waits for its relay. */
function warmHerdrCore(hc: HcInstall, env: NodeJS.ProcessEnv, hcSession: string): void {
  const child = spawn(hc.binary, ["server", "status"], {
    env: { ...env, HC_SESSION: hcSession },
    stdio: "ignore",
    detached: true,
  });

  child.unref();
}
