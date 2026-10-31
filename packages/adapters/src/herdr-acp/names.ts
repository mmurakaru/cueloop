import { createHash } from "node:crypto";
import { join } from "node:path";

/** Live terminal names are 1-32 characters of a-z, 0-9, and hyphen. */
export function herdrTerminalName(processKey: string): string {
  const digest = createHash("sha256").update(processKey).digest("hex").slice(0, 20);

  return `cl${digest}`;
}

export function herdrAcpDirectory(home: string): string {
  return join(home, "herdr-acp");
}

export function herdrSocketPath(home: string, processKey: string): string {
  return join(herdrAcpDirectory(home), `${herdrTerminalName(processKey)}.sock`);
}

export function herdrTranscriptPath(home: string, processKey: string): string {
  return join(herdrAcpDirectory(home), `${herdrTerminalName(processKey)}.ndjson`);
}

export function herdrEpochPath(home: string, processKey: string): string {
  return join(herdrAcpDirectory(home), `${herdrTerminalName(processKey)}.epoch`);
}

/** `hc --version` prints a line such as `hc 0.1.15`. */
export function parseHcVersion(text: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);

  if (!match) return undefined;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function hcVersionAtLeast(
  version: [number, number, number],
  minimum: [number, number, number],
): boolean {
  for (let index = 0; index < 3; index++) {
    if (version[index]! > minimum[index]!) return true;

    if (version[index]! < minimum[index]!) return false;
  }

  return true;
}

export const MINIMUM_HC_VERSION: [number, number, number] = [0, 1, 15];
