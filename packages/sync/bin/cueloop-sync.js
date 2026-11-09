#!/usr/bin/env node
import { runSyncCli } from "../dist/sync-cli.js";

try {
  process.exitCode = await runSyncCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Sync command failed");
  process.exitCode = 1;
}
