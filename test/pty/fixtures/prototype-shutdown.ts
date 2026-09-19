/**
 * A minimal stand-in for cueloop's shutdown wiring, used by the leak regression
 * test: warm a real prototype Chromium, print its pid, then close it on q,
 * SIGTERM, or SIGHUP - the same three paths run.ts routes into shutdown. The
 * parent asserts the pid is dead after each path, so a missing teardown fails.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closePrototypeBrowser,
  launchPrototypeRenderer,
  prototypeBrowserPidForTest,
} from "../../../packages/client/src/prototype-browser";

const shutdown = async (): Promise<void> => {
  await closePrototypeBrowser();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());
process.stdin.on("data", (chunk: Buffer) => {
  if (chunk.toString().includes("q")) void shutdown();
});

const htmlPath = join(tmpdir(), `cueloop-proto-shutdown-${process.pid}.html`);

writeFileSync(htmlPath, "<!doctype html><body><button>hi</button></body>");

try {
  const renderer = await launchPrototypeRenderer({
    filePath: htmlPath,
    viewport: { width: 120, height: 80 },
  });

  await renderer.screenshot();
  const pid = await prototypeBrowserPidForTest();

  process.stdout.write(`READY ${pid ?? 0}\n`);
} catch {
  // no Chrome on this machine; the test skips when it sees this
  process.stdout.write("NOCHROME\n");
  process.exit(0);
}

// stay alive until a quit path fires
setInterval(() => {}, 1 << 30);
