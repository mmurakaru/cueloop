/** A slow transport retains one pending refresh instead of every streaming update. */
export function createLatestStatePublisher(write: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let dirty = false;

  return () => {
    dirty = true;
    pending ??= (async () => {
      while (dirty) {
        dirty = false;
        await write();
      }
    })().finally(() => {
      pending = undefined;
    });

    return pending;
  };
}
