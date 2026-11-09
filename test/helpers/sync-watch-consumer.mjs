import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, watch } from "node:fs";
import { dirname } from "node:path";

const [executable, application, ready, cleanup, signal] = process.argv.slice(2);
const monitor = watch(dirname(ready));
const child = spawn(process.execPath, [executable, "connect", "--application", application], {
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(child, "exit");
let exitDeadline;

child.stdout.pause();

try {
  while (!existsSync(ready)) {
    await once(monitor, "change", { signal: AbortSignal.timeout(15000) });
  }

  if (
    readFileSync(ready, "utf8") !== (signal === "small-query-error" ? "small-blocked" : "blocked")
  ) {
    throw new Error("Sync watch fixture did not reach output backpressure");
  }

  if (signal === "SIGINT" || signal === "SIGTERM") child.kill(signal);

  const [status] = await Promise.race([
    exited,
    new Promise((_, reject) => {
      exitDeadline = setTimeout(
        () => reject(new Error("Interrupted sync watch did not exit")),
        5000,
      );
    }),
  ]);

  const expectedStatus = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;

  if (status !== expectedStatus) {
    throw new Error(`Interrupted sync watch returned unexpected status ${status}`);
  }

  if (readFileSync(cleanup, "utf8") !== "view\nclient\napplication\n") {
    throw new Error("Interrupted sync watch did not finish application cleanup");
  }

  console.log("Sync watch exited after cleanup");
} finally {
  clearTimeout(exitDeadline);
  monitor.close();

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }

  child.stdout.destroy();
  child.stderr.destroy();
}
