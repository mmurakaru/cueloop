/**
 * A parseable ed25519 private key. ssh2's generateKeyPairSync occasionally
 * emits a key its own parser then rejects ("Malformed OpenSSH private key") -
 * a rare encoding edge case. Regenerate until the key round-trips through
 * parseKey, so neither a real gateway host key nor a test client key can flake
 * on a key that cannot be loaded.
 */

import { utils } from "ssh2";

const MAX_ATTEMPTS = 8;

export function generateEd25519PrivateKey(): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const key = utils.generateKeyPairSync("ed25519").private;
    if (!(utils.parseKey(key) instanceof Error)) return key;
  }
  throw new Error(`ssh2 generateKeyPairSync produced no parseable ed25519 key in ${MAX_ATTEMPTS} attempts`);
}
