#!/usr/bin/env node
import { runSyncCli } from "../src/sync-cli.ts";

try {
  process.exitCode = await runSyncCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Sync command failed");
  process.exitCode = 1;
}
