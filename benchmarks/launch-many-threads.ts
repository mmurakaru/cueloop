/**
 * Launch cost as the inbox grows: seed a home with many threads, then measure the two costs a cold
 * launch pays over that inbox - the daemon's recovery scan at boot and the client's first inbox
 * list. Both must stay near flat as the thread count climbs; a number that tracks the count is the
 * O(threads) launch cost this benchmark guards against.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { HERMETIC_TERMINAL_ENV } from "../test/helpers/env";
import { largePlanMarkdown } from "./lib/fixtures";
import { emitMemoryMetrics, emitMetric, timeMs } from "./lib/metric";

Object.assign(process.env, HERMETIC_TERMINAL_ENV);

const THREADS = 200;
const home = mkdtempSync(join(tmpdir(), "cueloop-bench-launch-"));

try {
  // Seed the home with threads through one server, then stop it, so the measured boot below is a
  // real cold recovery from disk rather than a warm in-memory store.
  const seeder = new DaemonServer({ home, idleExitMs: 0 });

  seeder.start();
  const plan = largePlanMarkdown(16);

  for (let index = 0; index < THREADS; index++) {
    seeder.core.sessionCreate({
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: {
        type: "plan",
        content: plan,
        meta: { title: `Plan ${index}`, planPath: "plan.md" },
      },
    });
  }
  seeder.stop();

  emitMetric("threads", THREADS);

  // The daemon's boot-time recovery scan over every thread file runs in its constructor.
  let booted!: DaemonServer;

  emitMetric(
    "daemon_recover_ms",
    timeMs(() => {
      booted = new DaemonServer({ home, idleExitMs: 0 });
    }),
  );
  booted.start();

  const client = await DaemonClient.connect({ home });
  const listStarted = performance.now();
  const inbox = await client.sessionList();

  emitMetric("inbox_list_ms", performance.now() - listStarted);
  emitMetric("inbox_size", inbox.length);
  emitMemoryMetrics("after_launch");

  client.close();
  booted.stop();
} finally {
  rmSync(home, { recursive: true, force: true });
}
