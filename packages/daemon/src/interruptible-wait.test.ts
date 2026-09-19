import { describe, expect, test } from "bun:test";
import { ABORTED, pollUntilResolved, raceAbort } from "./interruptible-wait";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("raceAbort", () => {
  test("without a signal the promise passes straight through", async () => {
    expect(await raceAbort(Promise.resolve("value"), undefined)).toBe("value");
  });

  test("resolves to the value when the promise settles before any abort", async () => {
    const controller = new AbortController();

    expect(await raceAbort(Promise.resolve(7), controller.signal)).toBe(7);
  });

  test("an already-aborted signal returns ABORTED without waiting", async () => {
    const controller = new AbortController();

    controller.abort();

    expect(await raceAbort(new Promise<never>(() => {}), controller.signal)).toBe(ABORTED);
  });

  test("a signal that fires during the wait returns ABORTED", async () => {
    const controller = new AbortController();
    const pending = deferred<number>();
    const raced = raceAbort(pending.promise, controller.signal);

    controller.abort();

    expect(await raced).toBe(ABORTED);
  });

  test("a rejection propagates the original error unchanged", async () => {
    const controller = new AbortController();
    const original = new Error("daemon socket closed");
    let caught: unknown;

    try {
      await raceAbort(Promise.reject(original), controller.signal);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
  });

  test("a rejection that lands after an abort is swallowed, not surfaced", async () => {
    const controller = new AbortController();
    const pending = deferred<number>();
    const raced = raceAbort(pending.promise, controller.signal);

    controller.abort();
    const result = await raced;

    pending.reject(new Error("late daemon error"));
    await Bun.sleep(10);

    expect(result).toBe(ABORTED);
  });
});

describe("pollUntilResolved", () => {
  test("returns the first non-null attempt", async () => {
    expect(await pollUntilResolved(() => Promise.resolve("done"), undefined)).toBe("done");
  });

  test("keeps polling past null attempts until one resolves", async () => {
    let calls = 0;
    const attempt = () => {
      calls++;

      return Promise.resolve(calls < 3 ? null : "third");
    };

    expect(await pollUntilResolved(attempt, undefined)).toBe("third");
    expect(calls).toBe(3);
  });

  test("an already-aborted signal returns null before any attempt", async () => {
    const controller = new AbortController();
    let calls = 0;

    controller.abort();
    const result = await pollUntilResolved(() => {
      calls++;

      return Promise.resolve("value");
    }, controller.signal);

    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  test("a signal that fires during a chunk returns null", async () => {
    const controller = new AbortController();
    const pending = deferred<string | null>();
    const polling = pollUntilResolved(() => pending.promise, controller.signal);

    controller.abort();

    expect(await polling).toBeNull();
  });

  test("a rejected attempt propagates the original error", async () => {
    const original = new Error("attempt failed");
    let caught: unknown;

    try {
      await pollUntilResolved(() => Promise.reject(original), undefined);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
  });
});
