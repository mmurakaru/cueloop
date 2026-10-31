import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { FxAcpConnection, type FxAcpChild } from "./acp";

const ignore = () => undefined;

test("a supplied ACP child is used and the command is not spawned", async () => {
  const marker = `/tmp/cueloop-acp-spawn-${process.pid}`;

  rmSync(marker, { force: true });
  const child: FxAcpChild = {
    stdin: { write: ignore, on: ignore },
    stdout: { setEncoding: ignore, on: ignore },
    stderr: { resume: ignore },
    kill: ignore,
    detach: ignore,
    on: ignore,
  };
  const connection = new FxAcpConnection({
    command: ["sh", "-c", `echo $$ > ${marker}; sleep 30`],
    cwd: "/tmp",
    onFrame: ignore,
    onExit: ignore,
    child,
    detachOnClose: true,
  });

  await Bun.sleep(300);
  connection.close();

  if (existsSync(marker)) {
    const pid = Number(readFileSync(marker, "utf8"));

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The extra process already exited.
    }
  }

  expect(existsSync(marker)).toBe(false);
});
