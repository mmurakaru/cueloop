import { Cause, Effect, Exit } from "effect";

export const ABORTED: unique symbol = Symbol("aborted");

const whenSignalAborts = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);

      return;
    }
    const onAbort = () => resume(Effect.void);

    signal.addEventListener("abort", onAbort, { once: true });

    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const fromSettledPromise = <T>(start: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.callback<T, unknown>((resume) => {
    start().then(
      (value) => resume(Effect.succeed(value)),
      (cause: unknown) => resume(Effect.fail(cause)),
    );
  });

async function runToPromise<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) return exit.value;

  throw Cause.squash(exit.cause);
}

export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof ABORTED> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});

    return Promise.resolve(ABORTED);
  }

  return runToPromise(
    Effect.raceFirst(
      fromSettledPromise(() => promise),
      whenSignalAborts(signal).pipe(Effect.as<T | typeof ABORTED>(ABORTED)),
    ),
  );
}

export function pollUntilResolved<T>(
  attempt: () => Promise<T | null>,
  signal: AbortSignal | undefined,
): Promise<T | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const loop = Effect.repeat(fromSettledPromise(attempt), {
    until: (result): result is T => result !== null,
  });

  if (!signal) return runToPromise(loop);

  return runToPromise(Effect.raceFirst(loop, whenSignalAborts(signal).pipe(Effect.as(null))));
}
