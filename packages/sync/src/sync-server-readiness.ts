import * as v from "valibot";
import {
  SyncServerReadinessSchema,
  type SyncApplication,
  type SyncServerReadiness,
} from "./sync-server-protocol.ts";
import type { SyncTelemetry } from "./sync-telemetry.ts";

export function createSyncServerReadiness(options: {
  probe?: SyncApplication["readiness"];
  timeoutMilliseconds: number;
  telemetry: SyncTelemetry;
}) {
  let phase: "listening" | "closing" | "closed" = "listening";
  let activeRequests = 0;
  let previousReadiness: string | undefined;
  let probing: Promise<SyncServerReadiness> | undefined;
  let cancellation: AbortController | undefined;
  const closingState = (): SyncServerReadiness => ({
    ready: false,
    phase: phase === "closed" ? "closed" : "closing",
  });
  const observe = (state: SyncServerReadiness) => {
    const identity = `${state.phase}:${state.ready}`;

    if (identity !== previousReadiness)
      options.telemetry.event("authority.readiness", state.ready ? "ready" : "unready");

    previousReadiness = identity;

    return state;
  };
  const probe = async (): Promise<SyncServerReadiness> => {
    const applicationProbe = options.probe;

    if (!applicationProbe) return observe({ ready: false, phase: "initializing" });

    const controller = new AbortController();
    const interrupted = Promise.withResolvers<SyncServerReadiness>();
    const abort = () =>
      interrupted.resolve(
        phase === "listening" ? { ready: false, phase: "unavailable" } : closingState(),
      );
    const timer = setTimeout(() => controller.abort(), options.timeoutMilliseconds);

    cancellation = controller;
    controller.signal.addEventListener("abort", abort, { once: true });

    try {
      const state = await Promise.race([
        Promise.resolve().then(() => applicationProbe(controller.signal)),
        interrupted.promise,
      ]);

      return observe(
        phase === "listening" ? v.parse(SyncServerReadinessSchema, state) : closingState(),
      );
    } catch {
      return observe(
        phase === "listening" ? { ready: false, phase: "unavailable" } : closingState(),
      );
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      cancellation = undefined;
    }
  };

  return {
    admit(): boolean {
      if (phase !== "listening") return false;

      activeRequests += 1;
      options.telemetry.activeWork("http.server", 1);

      return true;
    },
    finish() {
      activeRequests = Math.max(0, activeRequests - 1);
      options.telemetry.activeWork("http.server", -1);
    },
    liveness() {
      return { healthy: phase !== "closed", phase, activeRequests };
    },
    readiness(): Promise<SyncServerReadiness> {
      if (phase !== "listening") return Promise.resolve(observe(closingState()));

      probing ??= probe().finally(() => {
        probing = undefined;
      });

      return probing;
    },
    beginClose() {
      phase = "closing";
      cancellation?.abort();
      observe(closingState());
    },
    closed() {
      phase = "closed";
      observe(closingState());
    },
  };
}

export type SyncServerState = ReturnType<typeof createSyncServerReadiness>;
