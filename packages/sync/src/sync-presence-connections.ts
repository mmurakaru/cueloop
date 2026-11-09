interface PresenceConnectionIdentity {
  connectionIdentifier: string;
  workspaceIdentifier: string;
  actorIdentifier: string;
}
interface PresenceConnectionRecord extends PresenceConnectionIdentity {
  closed: boolean;
  pending: number;
  expiresAt: number;
}
export interface SyncPresenceConnectionLease {
  isClosed(): boolean;
  leave(): void;
  release(): void;
}

/** Pending authorization retains its connection generation after a departure tombstone expires. */
export function createSyncPresenceConnections(now: () => number) {
  const records = new Map<string, PresenceConnectionRecord>();
  let closed = false;
  const expire = () => {
    for (const [identifier, record] of records) {
      if (record.pending === 0 && record.expiresAt <= now()) records.delete(identifier);
    }
  };

  return {
    reserve(identity: PresenceConnectionIdentity): SyncPresenceConnectionLease | Response {
      if (closed) return new Response("Presence authority is closed", { status: 503 });

      let record = records.get(identity.connectionIdentifier);

      if (record && record.pending === 0 && record.expiresAt <= now()) {
        records.delete(identity.connectionIdentifier);
        record = undefined;
      }

      if (
        record &&
        (record.actorIdentifier !== identity.actorIdentifier ||
          record.workspaceIdentifier !== identity.workspaceIdentifier)
      )
        return new Response("Presence connection is owned by another client", { status: 403 });

      if (!record) {
        if (records.size >= 20000) expire();

        if (records.size >= 20000)
          return new Response("Presence connection capacity reached", { status: 429 });

        record = { ...identity, closed: false, pending: 0, expiresAt: now() + 15000 };
        records.set(identity.connectionIdentifier, record);
      }

      const reserved = record;
      let released = false;

      reserved.pending++;

      return {
        isClosed: () => reserved.closed,
        leave() {
          reserved.closed = true;
          reserved.expiresAt = now() + 15000;
        },
        release() {
          if (released) return;

          released = true;
          reserved.pending--;

          if (!reserved.closed) reserved.expiresAt = now() + 15000;
        },
      };
    },
    expire,
    close() {
      closed = true;

      for (const record of records.values()) record.closed = true;

      records.clear();
    },
  };
}
