/**
 * The daemon over its real socket: time from start to listening, one client
 * connect (socket plus the ping and hello handshake), and session create and
 * get as a batch total that clears the gate's floor plus per-call p95. The
 * home is hand-rolled rather than taken from the test fixture because the
 * start itself is under measurement.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { HERMETIC_HERDR_ENV } from "../test/helpers/env";
import { largePlanMarkdown } from "./lib/fixtures";
import {
  emitLatencyMetrics,
  emitMemoryMetrics,
  emitMetric,
  timeMs,
  timeRepeatedAsync,
} from "./lib/metric";

Object.assign(process.env, HERMETIC_HERDR_ENV);

const CALLS = 200;

const home = mkdtempSync(join(tmpdir(), "cueloop-bench-daemon-"));
const server = new DaemonServer({ home, idleExitMs: 0 });

try {
  let socket: string | null = null;

  emitMetric(
    "daemon_start_to_listen_ms",
    timeMs(() => {
      socket = server.start();
    }),
  );
  if (socket === null) throw new Error("daemon-roundtrip: another daemon owns the temp home");
  const connectStarted = performance.now();
  const client = await DaemonClient.connect({ home });

  emitMetric("client_connect_ms", performance.now() - connectStarted);
  const plan = largePlanMarkdown(16);
  const ids: string[] = [];
  const createTimes = await timeRepeatedAsync(CALLS, async () => {
    const session = await client.sessionCreate(
      { repoRoot: "/repo", branch: "main" },
      { type: "plan", content: plan, meta: { title: `Plan ${ids.length}`, planPath: "plan.md" } },
    );

    ids.push(session.id);
  });
  let getIndex = 0;
  const getTimes = await timeRepeatedAsync(CALLS, async () => {
    await client.sessionGet(ids[getIndex++ % ids.length]!);
  });

  emitMetric("calls", CALLS);
  emitMetric(
    "session_create_total_ms",
    createTimes.reduce((sum, time) => sum + time, 0),
  );
  emitMetric(
    "session_get_total_ms",
    getTimes.reduce((sum, time) => sum + time, 0),
  );
  emitLatencyMetrics("session_create", createTimes);
  emitLatencyMetrics("session_get", getTimes);
  emitMemoryMetrics("after_sessions");
  client.close();
} finally {
  server.stop();
  rmSync(home, { recursive: true, force: true });
}
