import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { createCodexDeliveryService } from "@cueloop/adapters/codex/delivery-service";
import { createCodexSessionRegistry } from "@cueloop/adapters/codex/session-registry";
import { cueloopHome } from "@cueloop/daemon/paths";

const EMPTY_SESSION_GRACE_MS = 30_000;

function claimWorker(path: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(path, "wx", 0o600);

      writeSync(descriptor, String(process.pid));
      closeSync(descriptor);

      return true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const before = statSync(path);
      const owner = Number(readFileSync(path, "utf8"));

      if (Number.isSafeInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
          const command = Bun.spawnSync(["ps", "-p", String(owner), "-o", "command="], {
            stdout: "pipe",
            stderr: "ignore",
          });

          if (
            command.exitCode === 0 &&
            /(?:^|\s)codex-delivery-worker(?:\s|$)/.test(command.stdout.toString())
          )
            return false;
        } catch (cause) {
          if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) return false;
        }
      } else if (Date.now() - before.mtimeMs < 5_000) {
        return false;
      }
      if (statSync(path).ino !== before.ino) return false;
      unlinkSync(path);
    }
  }

  return false;
}

/** Run durable Codex Message delivery after the MCP transport has closed. */
export async function codexDeliveryWorkerCommand(): Promise<number> {
  const home = cueloopHome();
  const lockPath = join(home, "codex-delivery-worker.pid");

  if (!claimWorker(lockPath)) return 0;
  const sessions = createCodexSessionRegistry(home);
  const delivery = createCodexDeliveryService({
    home,
    codexBin: process.env.CUELOOP_CODEX_BIN,
  });
  let emptySince: number | undefined;

  try {
    delivery.start();
    while (true) {
      await Bun.sleep(1000);
      emptySince = sessions.list().length === 0 ? (emptySince ?? Date.now()) : undefined;

      if (emptySince !== undefined && Date.now() - emptySince >= EMPTY_SESSION_GRACE_MS) break;
    }
  } finally {
    delivery.stop();
    if (readFileSync(lockPath, "utf8") === String(process.pid)) unlinkSync(lockPath);
  }

  return 0;
}

/** The child owns the poller, so MCP transport shutdown does not stop delivery. */
export function startCodexDeliveryWorker(
  home: string,
  command = [...process.argv.slice(0, -1), "codex-delivery-worker"],
): ReturnType<typeof Bun.spawn> | undefined {
  try {
    const child = Bun.spawn(command, {
      env: { ...process.env, CUELOOP_HOME: home },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });

    child.unref();

    return child;
  } catch (error) {
    console.error(`cueloop Codex delivery worker: ${String(error)}`);
  }
}
