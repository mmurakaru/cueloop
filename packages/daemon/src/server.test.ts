import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { DaemonServer } from "./server";
import { DaemonClient, DaemonClientError } from "./client";
import type { Artifact, WorkspaceKey } from "@cueloop/schema";

const WS: WorkspaceKey = { repoRoot: "/repo", branch: "main" };
const PLAN: Artifact = { type: "plan", content: "# P\n\nBody text.\n", meta: {} };

let home: string;
let server: DaemonServer;
let client: DaemonClient;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-srv-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
});
afterEach(() => {
  client.close();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("socket round-trip", () => {
  test("ping and full session flow over the wire", async () => {
    // Assert
    expect((await client.ping()).pid).toBe(process.pid);

    // Act
    const session = await client.sessionCreate(WS, PLAN);

    // Assert
    expect(session.status).toBe("pending");

    // Act
    await client.sessionAnnotate(session.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "Body text", prefix: "", suffix: "." },
      body: "More detail please.",
    });
    const wait = client.sessionWait(session.id, 5_000);

    await client.sessionResolve(session.id, "request_changes", "Expand it.");
    const resolved = (await wait)!;

    // Assert
    expect(resolved.verdict!.kind).toBe("request_changes");
    expect(resolved.verdict!.feedback).toContain("More detail please.");
  });

  test("errors carry codes across the wire", async () => {
    await expect(client.sessionGet("nope")).rejects.toBeInstanceOf(DaemonClientError);
    await expect(client.sessionGet("nope")).rejects.toHaveProperty("code", "not_found");
  });

  test("events push to subscribed connections only", async () => {
    // Arrange
    const observer = await DaemonClient.connect({ home });
    const seen: string[] = [];

    observer.onEvent((event) => seen.push(event.event));
    await observer.subscribe();

    // Act
    const session = await client.sessionCreate(WS, PLAN);

    await client.sessionResolve(session.id, "approve", "");

    // Assert
    // events are pushed async over the socket; give the loop a beat
    await Bun.sleep(50);
    expect(seen).toContain("session.created");
    expect(seen).toContain("session.resolved");
    observer.close();
  });

  test("an event names the history entry its change appended", async () => {
    // Arrange
    const observer = await DaemonClient.connect({ home });
    const frames: Array<{ event: string; entryId?: string }> = [];

    observer.onEvent((event) => frames.push(event));
    await observer.subscribe();
    const session = await client.sessionCreate(WS, PLAN);

    // Act
    const annotated = await client.sessionAnnotate(session.id, {
      id: "a_evt",
      kind: "comment",
      anchor: { quote: "Plan", prefix: "", suffix: "" },
      body: "hello",
    });

    await Bun.sleep(50);

    // Assert: the update frame carries the comment entry's id
    const updated = frames.find((frame) => frame.event === "session.updated");

    expect(updated?.entryId).toBe(annotated.history!.entries.at(-1)!.id);
    observer.close();
  });

  test("a non-owner removes only the comments of the author it acts as, and names itself", async () => {
    // Arrange: the owner's and Ana's comments; an agent connection acting as Ana
    const session = await client.sessionCreate(WS, PLAN);

    await client.sessionAnnotate(session.id, {
      id: "own",
      kind: "comment",
      anchor: { quote: "Plan", prefix: "", suffix: "" },
      body: "mine",
    });
    await client.sessionAnnotate(session.id, {
      id: "anas",
      kind: "comment",
      anchor: { quote: "Plan", prefix: "", suffix: "" },
      body: "hers",
      author: "SHA256:ana",
    });
    const anonymous = await DaemonClient.connect({ home, role: "agent" });
    const agent = await DaemonClient.connect({ home, role: "agent", author: "SHA256:ana" });

    // Act + Assert: an unbound connection removes nothing; a bound one never another author's
    await expect(anonymous.sessionRemoveAnnotation(session.id, "own")).rejects.toHaveProperty(
      "code",
      "forbidden",
    );
    await expect(agent.sessionRemoveAnnotation(session.id, "own")).rejects.toHaveProperty(
      "code",
      "forbidden",
    );
    await expect(
      agent.sessionSetParticipantName(session.id, "SHA256:bob", "Not Bob"),
    ).rejects.toHaveProperty("code", "forbidden");

    // Act: her own comment goes, and she names herself
    const removed = await agent.sessionRemoveAnnotation(session.id, "anas");
    const named = await agent.sessionSetParticipantName(session.id, "SHA256:ana", "Ana");

    // Assert
    expect(removed.annotations.map((annotation) => annotation.id)).toEqual(["own"]);
    expect(removed.history!.entries.at(-1)).toMatchObject({
      type: "comment-removed",
      annotationId: "anas",
    });
    expect(named.participants).toContainEqual({ id: "SHA256:ana", provider: "ssh", name: "Ana" });
    anonymous.close();
    agent.close();
  });

  test("malformed requests get structured errors and never wedge the daemon", async () => {
    // missing required params
    await expect(
      client.request("session.create", { artifact: { type: "plan", content: "x" } }, v.object({})),
    ).rejects.toHaveProperty("code", "invalid_params");
    // wrong types
    await expect(client.request("session.wait", { id: 42 }, v.object({}))).rejects.toHaveProperty(
      "code",
      "invalid_params",
    );
    // unknown method
    await expect(client.request("session.nuke", {}, v.object({}))).rejects.toHaveProperty(
      "code",
      "unknown_method",
    );
    await Promise.all(
      ["__proto__", "toString", "constructor"].map((method) =>
        expect(client.request(method, {}, v.object({}))).rejects.toHaveProperty(
          "code",
          "unknown_method",
        ),
      ),
    );
    // the daemon is still fully alive afterwards
    const session = await client.sessionCreate(WS, PLAN);

    expect((await client.sessionGet(session.id)).id).toBe(session.id);
  });

  test("meta fields survive the wire: herdrPane set on create comes back from get", async () => {
    // Act
    const session = await client.sessionCreate(WS, {
      type: "plan",
      content: "# P",
      meta: { agent: "claude-code", herdrPane: "%7" },
    });
    const got = await client.sessionGet(session.id);

    // Assert
    expect(got.artifact.meta.herdrPane).toBe("%7");
    expect(got.artifact.meta.agent).toBe("claude-code");
  });

  test("share-sync primitives round-trip: setShareId persists, mergeShared unions notes and identities by id", async () => {
    // Given a shared session with one local note
    const session = await client.sessionCreate(WS, PLAN);
    const anchor = { quote: "Body text", prefix: "", suffix: "." };

    await client.sessionSetShareId(session.id, "p_abc123xy");
    await client.sessionAnnotate(session.id, { id: "a1", kind: "comment", anchor, body: "mine" });
    expect((await client.sessionGet(session.id)).shareId).toBe("p_abc123xy");

    // When a pull merges an update to the known id, a new collaborator note, and the collaborator's identity
    const merged = await client.sessionMergeShared(session.id, {
      annotations: [
        {
          id: "a1",
          kind: "comment",
          anchor,
          body: "should not overwrite",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a2",
          kind: "comment",
          anchor,
          body: "theirs",
          author: "SHA256:mate",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      participants: [{ id: "SHA256:mate", provider: "ssh", name: "Sam" }],
    });

    // Then notes union by id (existing a1 kept), and the participant registry carries the collaborator's name
    expect(merged.annotations.map((annotation) => annotation.id).sort()).toEqual(["a1", "a2"]);
    expect(merged.annotations.find((annotation) => annotation.id === "a1")!.body).toBe("mine");
    expect(merged.annotations.find((annotation) => annotation.id === "a2")!.author).toBe(
      "SHA256:mate",
    );
    expect(merged.participants).toEqual([{ id: "SHA256:mate", provider: "ssh", name: "Sam" }]);
  });

  test("mergeShared validates each annotation at the socket boundary", async () => {
    // Given a session
    const session = await client.sessionCreate(WS, PLAN);

    // When a malformed annotation is merged, it is rejected at the wire boundary
    // @ts-expect-error intentionally malformed annotation (empty id, missing fields)
    const merge = client.sessionMergeShared(session.id, { annotations: [{ id: "" }] });

    await expect(merge).rejects.toHaveProperty("code", "invalid_params");
  });

  test("session.delete removes a session over the wire", async () => {
    // Given a created session
    const session = await client.sessionCreate(WS, PLAN);

    // When it is deleted
    await client.sessionDelete(session.id);

    // Then it is gone, and deleting an unknown id is a not_found error
    await expect(client.sessionGet(session.id)).rejects.toBeInstanceOf(DaemonClientError);
    await expect(client.sessionDelete("ses_missing")).rejects.toHaveProperty("code", "not_found");
  });

  test("two clients see the same state (thin-renderer model)", async () => {
    // Arrange
    const second = await DaemonClient.connect({ home });

    // Act
    const session = await client.sessionCreate(WS, PLAN);
    const fromSecond = await second.sessionGet(session.id);

    // Assert
    expect(fromSecond.artifact.content).toBe(PLAN.content);
    second.close();
  });
});

describe("ownership is proven, never declared", () => {
  /** A wire frame as the daemon answers it: a result or a coded error. */
  interface WireReply {
    result?: unknown;
    error?: { code: string };
  }

  /** The request body a bare socket sends: the primitive's params as the wire carries them. */
  type WireParams = Parameters<typeof JSON.stringify>[0];

  interface RawConnection {
    call: (method: string, params: WireParams) => Promise<WireReply>;
    close: () => void;
  }

  /** A bare socket that speaks the wire protocol without the client's handshake. */
  async function rawConnection(): Promise<RawConnection> {
    const pending = new Map<number, (frame: WireReply) => void>();
    let buffered = "";
    let nextId = 1;
    const socket = await Bun.connect({
      unix: join(home, "cueloop.sock"),
      socket: {
        data: (_socket, data) => {
          buffered += data.toString();
          const lines = buffered.split("\n");

          buffered = lines.pop() ?? "";
          for (const line of lines) {
            const frame = JSON.parse(line);

            if ("id" in frame) pending.get(frame.id)?.(frame);
          }
        },
      },
    });

    return {
      call: (method, params) =>
        new Promise((resolve) => {
          const id = nextId++;

          pending.set(id, resolve);
          socket.write(JSON.stringify({ id, method, params }) + "\n");
        }),
      close: () => socket.end(),
    };
  }

  test("a connection that never proves ownership is a collaborator: it reads and comments, nothing more", async () => {
    // Arrange
    const session = await client.sessionCreate(WS, PLAN);
    const raw = await rawConnection();

    // Act + Assert
    expect((await raw.call("session.get", { id: session.id })).error).toBeUndefined();
    expect(
      (
        await raw.call("session.annotate", {
          id: session.id,
          annotation: {
            id: "a_raw",
            kind: "comment",
            anchor: { quote: "Plan", prefix: "", suffix: "" },
            body: "from a bare socket",
          },
        })
      ).error,
    ).toBeUndefined();
    expect(
      (await raw.call("session.resolve", { id: session.id, verdictKind: "approve", summary: "" }))
        .error?.code,
    ).toBe("forbidden");
    expect((await raw.call("session.delete", { id: session.id })).error?.code).toBe("forbidden");
    raw.close();
  });

  test("claiming ownership without the token is refused; the token grants it", async () => {
    // Arrange
    const raw = await rawConnection();

    // Act + Assert: a bare claim, then a wrong token, both refused
    expect((await raw.call("daemon.hello", { role: "owner" })).error?.code).toBe("forbidden");
    expect((await raw.call("daemon.hello", { role: "owner", token: "nope" })).error?.code).toBe(
      "forbidden",
    );
    expect((await raw.call("daemon.shutdown", {})).error?.code).toBe("forbidden");

    // Act: the token the daemon wrote into its home
    const token = readFileSync(join(home, "owner.token"), "utf8").trim();

    expect((await raw.call("daemon.hello", { role: "owner", token })).error).toBeUndefined();

    // Assert: owner primitives open up
    const created = await raw.call("session.create", { workspace: WS, artifact: PLAN });

    expect(created.error).toBeUndefined();
    raw.close();
  });

  test("a refused handshake reaches the caller and leaves the live daemon's socket alone", async () => {
    // Arrange: a token file that is not what the daemon minted
    const tokenPath = join(home, "owner.token");
    const minted = readFileSync(tokenPath, "utf8");

    writeFileSync(tokenPath, "0".repeat(64));

    // Act + Assert: the client hears the refusal; autostart does not replace the daemon
    await expect(DaemonClient.connect({ home, autostart: true })).rejects.toHaveProperty(
      "code",
      "forbidden",
    );
    expect(existsSync(join(home, "cueloop.sock"))).toBe(true);
    expect((await client.sessionList()).length).toBe(0);

    // Arrange: a token file that is not a token at all
    writeFileSync(tokenPath, "not-a-token");

    // Act + Assert
    await expect(DaemonClient.connect({ home })).rejects.toHaveProperty(
      "code",
      "invalid_owner_token",
    );
    writeFileSync(tokenPath, minted);
  });

  test("the token exists before the socket does", () => {
    // Arrange: a second daemon in another home
    const other = mkdtempSync(join(tmpdir(), "cueloop-token-"));
    const daemon = new DaemonServer({ home: other, idleExitMs: 0 });

    try {
      // Act
      daemon.start();

      // Assert: the token is on disk the moment the socket is
      expect(existsSync(join(other, "owner.token"))).toBe(true);
      expect(existsSync(join(other, "cueloop.sock"))).toBe(true);
    } finally {
      daemon.stop();
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("the daemon client proves ownership on connect and the token is private to the home", async () => {
    // Assert: the client in beforeEach connected as the owner through the token
    const session = await client.sessionCreate(WS, PLAN);

    expect((await client.sessionResolve(session.id, "approve", "")).status).toBe("resolved");
    expect(statSync(join(home, "owner.token")).mode & 0o777).toBe(0o600);
  });
});

describe("large payloads survive socket backpressure", () => {
  test("a session bigger than the kernel socket buffer round-trips", async () => {
    // Regression: responses larger than one socket write used to truncate
    // mid-line because the write return value was ignored, so the client
    // never saw the frame's newline and every later request wedged too.
    // Arrange
    const bigContent =
      "# Big plan\n" + "lorem ipsum dolor sit amet, consectetur adipiscing elit\n".repeat(4000);

    // Act
    const created = await client.sessionCreate(
      { repoRoot: "/repo", branch: "main" },
      { type: "plan", content: bigContent, meta: { title: "big" } },
    );
    const fetched = await client.sessionGet(created.id);

    // Assert
    expect(fetched.artifact.content).toBe(bigContent);

    // Act
    // the connection must still be usable for the next frame
    const listed = await client.sessionList();

    // Assert
    expect(listed.some((session) => session.id === created.id)).toBe(true);
  }, 15_000);
});
