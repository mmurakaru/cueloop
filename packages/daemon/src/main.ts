/** Daemon entry point: run detached by DaemonClient.connect({autostart}). */

import { DaemonServer } from "./server";

const idleExitMs = process.env.CUELOOP_IDLE_EXIT_MS ? Number(process.env.CUELOOP_IDLE_EXIT_MS) : undefined;
const server = new DaemonServer({ idleExitMs });
const path = server.start();
if (path === null) {
  // another daemon already owns this home; the client will attach to it
  console.log("cueloop daemon already running for this home");
  process.exit(0);
}
console.log(`cueloop daemon listening on ${path}`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});
