#!/usr/bin/env node
import { runSyncCli } from "../dist/sync-cli.js";

try {
  const status = await runSyncCli(process.argv.slice(2));

  // Interrupted watches can retain a blocked stdout write after cleanup.
  if (status === 130 || status === 143) process.exit(status);

  process.exitCode = status;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Sync command failed");

  if (process.stdout.writableLength > 0) process.exit(1);

  process.exitCode = 1;
}
