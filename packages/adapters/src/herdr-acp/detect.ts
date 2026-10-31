import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { MINIMUM_HC_VERSION, hcVersionAtLeast, parseHcVersion } from "./names";

export interface HcInstall {
  binary: string;
  version: string;
}

/** Locate a user-installed hc. A missing or older binary is absence, not an error. */
export function detectHc(env: NodeJS.ProcessEnv = process.env): HcInstall | undefined {
  const binary = env.CUELOOP_HC || findOnPath(env.PATH, "hc");

  if (!binary) return undefined;

  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 2_000,
    env,
  });

  if (result.status !== 0) return undefined;

  const version = parseHcVersion(`${result.stdout}\n${result.stderr}`);

  if (!version || !hcVersionAtLeast(version, MINIMUM_HC_VERSION)) return undefined;

  return { binary, version: version.join(".") };
}

export function findOnPath(path: string | undefined, name: string): string | undefined {
  if (!path || name.includes("/") || name.includes("\\")) return undefined;

  for (const directory of path.split(delimiter)) {
    if (!directory) continue;

    const candidate = join(directory, name);

    if (!isExecutable(candidate)) continue;

    return candidate;
  }

  return undefined;
}

function isExecutable(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false;

  try {
    accessSync(candidate, constants.X_OK);

    return true;
  } catch {
    return false;
  }
}
