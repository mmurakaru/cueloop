import {
  ROOT_CONTEXT,
  type Context,
  type TextMapPropagator,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import * as v from "valibot";

const propagationHeaders = ["traceparent", "tracestate"];
const PropagationValueSchema = v.pipe(v.string(), v.maxLength(512));
const getter: TextMapGetter<Headers> = {
  keys: (carrier) => propagationHeaders.filter((name) => carrier.has(name)),
  get: (carrier, name) => {
    if (!propagationHeaders.includes(name)) return undefined;

    const value = v.safeParse(PropagationValueSchema, carrier.get(name));

    return value.success ? value.output : undefined;
  },
};
const setter: TextMapSetter<Headers> = {
  set: (carrier, name, value) => {
    if (propagationHeaders.includes(name))
      carrier.set(name, v.parse(PropagationValueSchema, value));
  },
};

export function attemptSyncTelemetry<Result>(observe: () => Result): Result | undefined {
  try {
    return observe();
  } catch {
    return undefined;
  }
}

export interface SyncTelemetryContextScope {
  active(): Context;
  with<Result>(parent: Context, callback: () => Result): Result;
}

type SyncTelemetryInvocation<Result> =
  | { status: "waiting" }
  | { status: "returned"; result: Result }
  | { status: "threw"; cause: unknown };

interface SyncTelemetryInvocationState<Result> {
  invocation: SyncTelemetryInvocation<Result>;
}

/** A throwing context provider cannot repeat a callback that may have committed application work. */
export function runSyncTelemetryContext<Result>(
  scope: SyncTelemetryContextScope,
  parent: Context,
  callback: () => Result,
): Result {
  const state: SyncTelemetryInvocationState<Result> = { invocation: { status: "waiting" } };
  const invoke = () => {
    if (state.invocation.status !== "waiting") return;

    try {
      state.invocation = { status: "returned", result: callback() };
    } catch (cause) {
      state.invocation = { status: "threw", cause };
    }
  };

  attemptSyncTelemetry(() => scope.with(parent, invoke));
  invoke();

  if (state.invocation.status === "threw") throw state.invocation.cause;

  if (state.invocation.status !== "returned")
    throw new Error("Sync telemetry callback was not invoked");

  return state.invocation.result;
}

export function injectSyncTraceContext(
  propagator: TextMapPropagator,
  parent: Context,
  headers: Headers,
): void {
  attemptSyncTelemetry(() => propagator.inject(parent, headers, setter));
}

export function extractSyncTraceContext(propagator: TextMapPropagator, headers: Headers): Context {
  return (
    attemptSyncTelemetry(() => propagator.extract(ROOT_CONTEXT, headers, getter)) ?? ROOT_CONTEXT
  );
}
