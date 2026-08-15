/**
 * The gateway's SSH host key, persisted so its fingerprint stays stable across
 * restarts - otherwise every viewer gets a fresh "host identification changed"
 * prompt. Generated once (ed25519), stored 0600.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateEd25519PrivateKey } from "./ssh-key";

/** Read the host key at `path`, or generate and persist one on first boot. */
export function loadOrCreateHostKey(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = generateEd25519PrivateKey();
  writeFileSync(path, key, { mode: 0o600 });
  return key;
}
