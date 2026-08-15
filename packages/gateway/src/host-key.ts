/**
 * The gateway's SSH host key, persisted so its fingerprint stays stable across
 * restarts - otherwise every viewer gets a fresh "host identification changed"
 * prompt. Generated once (ed25519), stored 0600.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { utils } from "ssh2";

// ssh2's generator rarely emits a key its own parser rejects; regenerate until valid.
export function generateEd25519Key(): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = utils.generateKeyPairSync("ed25519").private;
    if (!(utils.parseKey(key) instanceof Error)) return key;
  }
  throw new Error("ssh2 could not generate a parseable ed25519 key");
}

/** Read the host key at `path`, or generate and persist one on first boot. */
export function loadOrCreateHostKey(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = generateEd25519Key();
  writeFileSync(path, key, { mode: 0o600 });
  return key;
}
