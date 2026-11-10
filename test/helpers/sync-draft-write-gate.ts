import { spyOn } from "bun:test";
import { SQLiteStore } from "@rocicorp/zero/sqlite";
import * as v from "valibot";

export function pauseTestSyncDraftWrite(draftIdentifier: string) {
  const received = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const write = SQLiteStore.prototype.write;
  let paused = false;
  const interception = spyOn(SQLiteStore.prototype, "write").mockImplementation(async function (
    this: SQLiteStore,
  ) {
    const read = await this.read();
    let selected = false;

    try {
      const records = v.safeParse(
        v.array(v.object({ draftIdentifier: v.string() })),
        await read.get("drafts"),
      );

      selected =
        records.success &&
        records.output.some((record) => record.draftIdentifier === draftIdentifier);
    } finally {
      read.release();
    }

    if (!paused && selected) {
      paused = true;
      received.resolve();
      await released.promise;
    }

    return write.call(this);
  });

  return {
    received: received.promise,
    release: () => released.resolve(),
    close() {
      released.resolve();
      interception.mockRestore();
    },
  };
}
