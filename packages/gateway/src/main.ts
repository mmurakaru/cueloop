#!/usr/bin/env bun
/**
 * The gateway process. Reads its config from the environment, builds the store
 * and master key, and serves. In production the store is R2 and the master key
 * lives at /etc/cueloop/master.key (0600, VM-only). Set CUELOOP_STORE=memory to
 * run a throwaway local gateway with an ephemeral key - the manual-verify path.
 */

import { readFileSync } from "node:fs";
import { KEY_BYTES, generateMasterKey } from "./crypto";
import { startGateway } from "./server";
import { MemoryShareStore, r2StoreFromEnv, type ShareStore } from "./store";

function loadMasterKey(path: string): Buffer {
  const key = readFileSync(path);

  if (key.length !== KEY_BYTES)
    throw new Error(`master key at ${path} must be exactly ${KEY_BYTES} bytes`);

  return key;
}

async function main(): Promise<void> {
  const useMemory = process.env.CUELOOP_STORE === "memory";
  const store: ShareStore = useMemory ? new MemoryShareStore() : r2StoreFromEnv();
  const masterKey = useMemory
    ? generateMasterKey()
    : loadMasterKey(process.env.CUELOOP_MASTER_KEY_PATH ?? "/etc/cueloop/master.key");

  const handle = await startGateway({
    store,
    masterKey,
    hostKeyPath: process.env.CUELOOP_HOST_KEY_PATH ?? "/etc/cueloop/host_key",
    port: Number(process.env.CUELOOP_GATEWAY_PORT ?? 22),
    host: process.env.CUELOOP_GATEWAY_HOST,
    publicHost: process.env.CUELOOP_PUBLIC_HOST,
    // Off unless CUELOOP_METRICS_PORT is set; binds loopback so it never faces the internet.
    metricsPort: process.env.CUELOOP_METRICS_PORT
      ? Number(process.env.CUELOOP_METRICS_PORT)
      : undefined,
    metricsHost: process.env.CUELOOP_METRICS_HOST,
  });

  const metricsNote = process.env.CUELOOP_METRICS_PORT
    ? `, metrics on ${process.env.CUELOOP_METRICS_HOST ?? "127.0.0.1"}:${process.env.CUELOOP_METRICS_PORT}`
    : "";

  console.log(
    `cueloop gateway listening on ${handle.host}:${handle.port}${useMemory ? " (memory store, ephemeral key)" : ""}${metricsNote}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void handle.close().then(() => process.exit(0)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
