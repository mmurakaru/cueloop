import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
    expect(client.sessionGet("nope")).rejects.toBeInstanceOf(DaemonClientError);
    try {
      await client.sessionGet("nope");
    } catch (error) {
      expect((error as DaemonClientError).code).toBe("not_found");
    }
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

  test("malformed requests get structured errors and never wedge the daemon", async () => {
    // missing required params
    try {
      await client.request(
        "session.create",
        { artifact: { type: "plan", content: "x" } },
        v.object({}),
      );
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as DaemonClientError).code).toBe("invalid_params");
    }
    // wrong types
    try {
      await client.request("session.wait", { id: 42 }, v.object({}));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as DaemonClientError).code).toBe("invalid_params");
    }
    // unknown method
    try {
      await client.request("session.nuke", {}, v.object({}));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as DaemonClientError).code).toBe("unknown_method");
    }
    const prototypeMethods = await Promise.allSettled([
      client.request("__proto__", {}, v.object({})),
      client.request("toString", {}, v.object({})),
      client.request("constructor", {}, v.object({})),
    ]);

    for (const result of prototypeMethods) {
      expect(result.status).toBe("rejected");
      expect(((result as PromiseRejectedResult).reason as DaemonClientError).code).toBe(
        "unknown_method",
      );
    }
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

  test("share-sync verbs round-trip: setShareId persists, mergeShared unions notes and identities by id", async () => {
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

    try {
      // When a malformed annotation is merged
      // @ts-expect-error intentionally malformed annotation (empty id, missing fields)
      await client.sessionMergeShared(session.id, { annotations: [{ id: "" }] });
      throw new Error("should have thrown");
    } catch (error) {
      // Then it is rejected at the wire boundary
      expect((error as DaemonClientError).code).toBe("invalid_params");
    }
  });

  test("session.delete removes a session over the wire", async () => {
    // Given a created session
    const session = await client.sessionCreate(WS, PLAN);

    // When it is deleted
    await client.sessionDelete(session.id);

    // Then it is gone, and deleting an unknown id is a not_found error
    expect(client.sessionGet(session.id)).rejects.toBeInstanceOf(DaemonClientError);
    try {
      await client.sessionDelete("ses_missing");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as DaemonClientError).code).toBe("not_found");
    }
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
