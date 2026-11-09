import type { SyncPresenceSelection } from "./sync-presence-protocol.ts";
import { expect, test } from "bun:test";
import { createSyncPresenceAuthority } from "./sync-presence-authority.ts";

interface TestPresenceInput {
  action: "publish" | "read" | "leave";
  connectionIdentifier?: string;
  sequence?: number;
  typing?: boolean;
  selection?: SyncPresenceSelection | null;
}

const WORKSPACE = "019a6819-bf85-7000-8000-000000000001";
const FIRST_CONNECTION = "019a6819-bf85-7000-8000-000000000002";
const SECOND_CONNECTION = "019a6819-bf85-7000-8000-000000000003";

test("presence expires and permission revocation removes future delivery without saving history", async () => {
  let now = 1000;
  const members = new Set(["alice", "bob"]);
  const authority = createSyncPresenceAuthority({
    authenticate: async (request) => {
      const actorIdentifier = request.headers.get("authorization");

      return actorIdentifier ? { actorIdentifier } : null;
    },
    authorize: async (options) =>
      options.workspaceIdentifier === WORKSPACE
        ? options.actorIdentifiers.filter((actor) => members.has(actor))
        : [],
    now: () => now,
  });
  const send = (actor: string, body: TestPresenceInput) =>
    authority.fetch(
      new Request("https://authority.test/presence", {
        method: "POST",
        headers: { authorization: actor },
        body: JSON.stringify({ workspaceIdentifier: WORKSPACE, ...body }),
      }),
    );

  try {
    expect(
      (
        await send("alice", {
          action: "publish",
          connectionIdentifier: FIRST_CONNECTION,
          sequence: 1,
          typing: true,
          selection: null,
        })
      ).status,
    ).toBe(200);
    const first = await send("bob", {
      action: "publish",
      connectionIdentifier: SECOND_CONNECTION,
      sequence: 1,
      typing: false,
      selection: null,
    });

    expect(await first.json()).toMatchObject({
      peers: [
        { actorIdentifier: "alice", typing: true },
        { actorIdentifier: "bob", typing: false },
      ],
    });
    now = 5000;
    const idle = await send("bob", { action: "read" });

    expect(await idle.json()).toMatchObject({
      peers: [
        { actorIdentifier: "alice", typing: false },
        { actorIdentifier: "bob", typing: false },
      ],
    });
    members.delete("alice");
    const revoked = await send("bob", { action: "read" });

    expect(await revoked.json()).toMatchObject({ peers: [{ actorIdentifier: "bob" }] });
    expect((await send("alice", { action: "read" })).status).toBe(403);
    now = 17000;
    expect(await (await send("bob", { action: "read" })).json()).toMatchObject({ peers: [] });
  } finally {
    authority.close();
  }
});

test("duplicate and stale heartbeats cannot replace newer presence or extend its lease", async () => {
  let now = 1000;
  const authority = createSyncPresenceAuthority({
    authenticate: async (request) => ({
      actorIdentifier: request.headers.get("authorization") ?? "",
    }),
    authorize: async (access) => access.actorIdentifiers,
    now: () => now,
  });
  const publish = (actor: string, sequence: number, typing: boolean) =>
    authority.fetch(
      new Request("https://authority.test/presence", {
        method: "POST",
        headers: { authorization: actor },
        body: JSON.stringify({
          action: "publish",
          workspaceIdentifier: WORKSPACE,
          connectionIdentifier: FIRST_CONNECTION,
          sequence,
          typing,
          selection: null,
        }),
      }),
    );

  try {
    await publish("alice", 2, false);
    expect((await publish("bob", 3, true)).status).toBe(403);
    now = 14000;
    const stale = await publish("alice", 1, true);

    expect(await stale.json()).toMatchObject({
      peers: [{ actorIdentifier: "alice", sequence: 2, typing: false, expiresAt: 16000 }],
    });
    const duplicate = await publish("alice", 2, true);

    expect(await duplicate.json()).toMatchObject({
      peers: [{ sequence: 2, typing: false, expiresAt: 16000 }],
    });
    now = 16001;
    const expired = await authority.fetch(
      new Request("https://authority.test/presence", {
        method: "POST",
        headers: { authorization: "alice" },
        body: JSON.stringify({ action: "read", workspaceIdentifier: WORKSPACE }),
      }),
    );

    expect(await expired.json()).toMatchObject({ peers: [] });
  } finally {
    authority.close();
  }
});

test("presence bounds per-actor connections, input size, and request rate", async () => {
  let now = 1000;
  const authority = createSyncPresenceAuthority({
    authenticate: async () => ({ actorIdentifier: "alice" }),
    authorize: async (access) => access.actorIdentifiers,
    now: () => now,
  });
  const send = (body: TestPresenceInput) =>
    authority.fetch(
      new Request("https://authority.test/presence", {
        method: "POST",
        body: JSON.stringify({ workspaceIdentifier: WORKSPACE, ...body }),
      }),
    );

  try {
    for (const connectionIdentifier of Array.from({ length: 4 }, () => crypto.randomUUID())) {
      expect(
        (
          await send({
            action: "publish",
            connectionIdentifier,
            sequence: 1,
            typing: false,
            selection: null,
          })
        ).status,
      ).toBe(200);
    }

    expect(
      (
        await send({
          action: "publish",
          connectionIdentifier: crypto.randomUUID(),
          sequence: 1,
          typing: false,
          selection: null,
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await send({
          action: "publish",
          connectionIdentifier: FIRST_CONNECTION,
          sequence: 1,
          typing: false,
          selection: { documentIdentifier: WORKSPACE, anchor: "a".repeat(5000), focus: "AAAA" },
        })
      ).status,
    ).toBe(400);

    const responses = await Promise.all(Array.from({ length: 15 }, () => send({ action: "read" })));

    for (const response of responses) expect(response.status).toBe(200);

    expect((await send({ action: "read" })).status).toBe(429);
    now = 2001;
    expect((await send({ action: "read" })).status).toBe(200);
  } finally {
    authority.close();
  }
});
