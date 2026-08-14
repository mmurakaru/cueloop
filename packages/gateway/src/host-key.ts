/**
 * The gateway's SSH host key, persisted so its fingerprint stays stable across
 * restarts - otherwise every viewer gets a fresh "host identification changed"
 * prompt. Generated once (ed25519), stored 0600.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { utils } from "ssh2";

/** Read the host key at `path`, or generate and persist one on first boot. */
export function loadOrCreateHostKey(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pair = utils.generateKeyPairSync("ed25519");
  writeFileSync(path, pair.private, { mode: 0o600 });
  return pair.private;
}
