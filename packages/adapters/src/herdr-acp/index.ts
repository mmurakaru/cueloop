import { createHerdrAcp, type HerdrAcpIntegration, type HerdrAcpOptions } from "./binding";
import { detectHc, type HcInstall } from "./detect";

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
    });
  }

  const found = (options.detect ?? (() => detectHc(options.env)))();

  if (!found) {
    (options.warn ?? ((message) => console.error(message)))(UNAVAILABLE);

    return undefined;
  }

  return createHerdrAcp({
    home: options.home,
    command: options.command,
    launch: "hc",
    hc: found,
    env: options.env,
    hcSession: options.hcSession,
    xdgRuntimeDir: options.xdgRuntimeDir,
  });
}
