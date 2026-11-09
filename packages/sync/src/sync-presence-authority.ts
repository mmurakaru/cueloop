import * as v from "valibot";
import { SyncPresenceRequestSchema, type SyncPresencePeer } from "./sync-presence-protocol.ts";

interface PresenceEntry {
  peer: SyncPresencePeer;
  typingExpiresAt: number;
}
interface PresenceAccess {
  actorIdentifier: string;
  workspaceIdentifier: string;
}

async function readPresenceRequest(request: Request) {
  const reader = request.body?.getReader();

  if (!reader) throw new Error("Sync presence request body is required");

  let length = 0;
  const chunks: Uint8Array[] = [];

  try {
    for (;;) {
      const result = await reader.read();

      if (result.done) break;

      length += result.value.byteLength;

      if (length > 4096) {
        await reader.cancel();
        throw new Error("Sync presence request exceeds its byte budget");
      }

      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return v.parse(SyncPresenceRequestSchema, JSON.parse(new TextDecoder().decode(bytes)));
}

/** Presence is volatile, expires after 15 seconds, and rechecks permissions before every delivery. */
export function createSyncPresenceAuthority(options: {
  authenticate: (request: Request) => Promise<{ actorIdentifier: string } | null>;
  authorize: (access: {
    workspaceIdentifier: string;
    actorIdentifiers: readonly string[];
  }) => Promise<readonly string[]>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, PresenceEntry>();
  const rooms = new Map<string, Set<string>>();
  const rates = new Map<string, { startedAt: number; count: number }>();
  let closed = false;
  const removeEntry = (identifier: string) => {
    const entry = entries.get(identifier);

    if (!entry) return;

    entries.delete(identifier);
    const room = rooms.get(entry.peer.workspaceIdentifier);

    room?.delete(identifier);

    if (room?.size === 0) rooms.delete(entry.peer.workspaceIdentifier);
  };
  const roomEntries = (workspaceIdentifier: string): PresenceEntry[] => {
    return [...(rooms.get(workspaceIdentifier) ?? [])].flatMap((identifier) => {
      const entry = entries.get(identifier);

      return entry ? [entry] : [];
    });
  };
  const expire = () => {
    const current = now();

    for (const [identifier, entry] of entries) {
      if (entry.peer.expiresAt <= current) removeEntry(identifier);
    }

    for (const [actor, rate] of rates) {
      if (rate.startedAt + 1000 <= current) rates.delete(actor);
    }
  };
  const timer = setInterval(expire, 5000);

  timer.unref?.();

  const admit = (
    access: PresenceAccess,
    input: v.InferOutput<typeof SyncPresenceRequestSchema>,
  ): Response | undefined => {
    if (input.action === "read") return;

    const previous = entries.get(input.connectionIdentifier);

    if (
      previous &&
      (previous.peer.actorIdentifier !== access.actorIdentifier ||
        previous.peer.workspaceIdentifier !== access.workspaceIdentifier)
    )
      return new Response("Presence connection is owned by another client", { status: 403 });

    if (input.action === "leave") {
      removeEntry(input.connectionIdentifier);

      return;
    }

    if (previous && input.sequence <= previous.peer.sequence) return;

    if (!previous) {
      const room = roomEntries(access.workspaceIdentifier);
      const actorConnections = room.filter(
        (entry) => entry.peer.actorIdentifier === access.actorIdentifier,
      );

      if (entries.size >= 10000 || room.length >= 100 || actorConnections.length >= 4)
        return new Response("Presence capacity reached", { status: 429 });
    }

    const current = now();

    const connections = rooms.get(access.workspaceIdentifier) ?? new Set<string>();

    connections.add(input.connectionIdentifier);
    rooms.set(access.workspaceIdentifier, connections);
    entries.set(input.connectionIdentifier, {
      peer: {
        workspaceIdentifier: input.workspaceIdentifier,
        connectionIdentifier: input.connectionIdentifier,
        sequence: input.sequence,
        typing: input.typing,
        selection: input.selection,
        actorIdentifier: access.actorIdentifier,
        expiresAt: current + 15000,
      },
      typingExpiresAt: input.typing ? current + 3000 : current,
    });
  };
  const limitPresenceRate = (actorIdentifier: string): Response | undefined => {
    const previousRate = rates.get(actorIdentifier);
    const rate = previousRate && previousRate.startedAt + 1000 > now() ? previousRate : undefined;

    if (rate && rate.count >= 20)
      return new Response("Presence rate limit reached", { status: 429 });

    if (!rate && rates.size >= 10000)
      return new Response("Presence capacity reached", { status: 429 });

    rates.set(actorIdentifier, {
      startedAt: rate?.startedAt ?? now(),
      count: (rate?.count ?? 0) + 1,
    });
  };
  const readPeers = (
    workspaceIdentifier: string,
    checked: ReadonlySet<string>,
    authorized: ReadonlySet<string>,
  ) => {
    const peers: SyncPresencePeer[] = [];

    for (const entry of roomEntries(workspaceIdentifier)) {
      if (!checked.has(entry.peer.actorIdentifier)) continue;

      if (!authorized.has(entry.peer.actorIdentifier)) {
        removeEntry(entry.peer.connectionIdentifier);
      } else if (entry.peer.expiresAt > now()) {
        peers.push({ ...entry.peer, typing: entry.peer.typing && entry.typingExpiresAt > now() });
      }
    }

    return peers.toSorted((left, right) =>
      left.connectionIdentifier.localeCompare(right.connectionIdentifier),
    );
  };

  return {
    async fetch(request: Request): Promise<Response> {
      if (closed) return new Response("Presence authority is closed", { status: 503 });

      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

      const principal = await options.authenticate(request);

      if (!principal) return new Response("Unauthorized", { status: 401 });

      let input: v.InferOutput<typeof SyncPresenceRequestSchema>;

      try {
        input = await readPresenceRequest(request);
      } catch {
        return new Response("Invalid presence request", { status: 400 });
      }

      const access = {
        actorIdentifier: principal.actorIdentifier,
        workspaceIdentifier: input.workspaceIdentifier,
      };

      try {
        for (const entry of roomEntries(access.workspaceIdentifier)) {
          if (entry.peer.expiresAt <= now()) removeEntry(entry.peer.connectionIdentifier);
        }

        const rateFailure = limitPresenceRate(access.actorIdentifier);

        if (rateFailure) return rateFailure;

        const checked = new Set([
          access.actorIdentifier,
          ...roomEntries(access.workspaceIdentifier).map((entry) => entry.peer.actorIdentifier),
        ]);
        const authorized = new Set(
          await options.authorize({
            workspaceIdentifier: access.workspaceIdentifier,
            actorIdentifiers: [...checked],
          }),
        );

        if (closed) return new Response("Presence authority is closed", { status: 503 });

        readPeers(access.workspaceIdentifier, checked, authorized);

        if (!authorized.has(access.actorIdentifier))
          return new Response("Forbidden", { status: 403 });

        const rejected = admit(access, input);

        if (rejected) return rejected;

        if (closed) return new Response("Presence authority is closed", { status: 503 });

        const admittedPeers = readPeers(access.workspaceIdentifier, checked, authorized);

        return Response.json(
          { peers: admittedPeers, leaseMilliseconds: 15000 },
          { headers: { "cache-control": "no-store" } },
        );
      } catch {
        return new Response("Presence access is unavailable", { status: 503 });
      }
    },
    close() {
      closed = true;
      clearInterval(timer);
      entries.clear();
      rooms.clear();
      rates.clear();
    },
  };
}
