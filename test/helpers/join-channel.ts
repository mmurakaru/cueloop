import type { JoinChannel } from "../../packages/gateway/src/collaborator-join";

export interface TestJoinChannel extends JoinChannel {
  writes: string[];
  emitKey: (data: string) => void;
  emitClose: () => void;
}

/** A fake SSH channel: records what the join flow draws and lets a test feed keys or a disconnect. */
export function createTestJoinChannel(): TestJoinChannel {
  const dataListeners = new Set<(chunk: Buffer) => void>();
  const closeListeners = new Set<() => void>();
  const writes: string[] = [];

  return {
    writes,
    write: (data) => {
      writes.push(data);
    },
    on: (event, listener) => {
      if (event === "close") {
        // SAFETY: the on("close") overload guarantees a no-argument listener.
        closeListeners.add(listener as () => void);

        return;
      }
      // SAFETY: the remaining on("data") overload guarantees a chunk listener.
      dataListeners.add(listener as (chunk: Buffer) => void);
    },
    removeListener: (event, listener) => {
      if (event === "close") {
        // SAFETY: the removeListener("close") overload guarantees a no-argument listener.
        closeListeners.delete(listener as () => void);

        return;
      }
      // SAFETY: the remaining removeListener("data") overload guarantees a chunk listener.
      dataListeners.delete(listener as (chunk: Buffer) => void);
    },
    emitKey: (data) => {
      for (const listener of dataListeners) listener(Buffer.from(data));
    },
    emitClose: () => {
      for (const listener of closeListeners) listener();
    },
  };
}
