---
"@cueloop/gateway": patch
---

Guard ed25519 key generation behind a parse round-trip. ssh2's `generateKeyPairSync` occasionally emits a private key its own parser then rejects ("Malformed OpenSSH private key"); the gateway now regenerates until the key loads, so a first-boot host key (and the share e2e client key) can no longer land on an unusable key.
