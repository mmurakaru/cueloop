import type { JoinChannel } from "../../packages/gateway/src/collaborator-join";

export interface TestJoinChannel extends JoinChannel {
  writes: string[];
  emitKey: (data: string) => void;
}

/** A fake SSH channel: records what the join flow draws and lets a test feed keys. */
export function createTestJoinChannel(): TestJoinChannel {
  const listeners = new Set<(chunk: Buffer) => void>();
  const writes: string[] = [];

  return {
    writes,
    write: (data) => {
      writes.push(data);
    },
    on: (_event, listener) => {
      listeners.add(listener);
    },
    removeListener: (_event, listener) => {
      listeners.delete(listener);
    },
    emitKey: (data) => {
      for (const listener of listeners) listener(Buffer.from(data));
    },
  };
}
