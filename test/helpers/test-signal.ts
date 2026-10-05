/** A test latch waits for an observed event rather than a timing assumption. */
export function createTestSignal<Value>() {
  let resolve!: (value: Value) => void;
  // eslint-disable-next-line type-evidence/no-unknown-parameters -- This latch forwards Promise rejection reasons unchanged.
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });

  return { promise, resolve, reject };
}
