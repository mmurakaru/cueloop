import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect((await client.ping()).pid).toBe(process.pid);
    const s = await client.sessionCreate(WS, PLAN);
    expect(s.status).toBe("pending");
    await client.sessionAnnotate(s.id, {
      id: "a1",
      kind: "comment",
      anchor: { quote: "Body text", prefix: "", suffix: "." },
      body: "More detail please.",
    });
    const wait = client.sessionWait(s.id, 5_000);
    await client.sessionResolve(s.id, "request_changes", "Expand it.");
    const resolved = (await wait)!;
    expect(resolved.verdict!.kind).toBe("request_changes");
    expect(resolved.verdict!.feedback).toContain("More detail please.");
  });

  test("errors carry codes across the wire", async () => {
    expect(client.sessionGet("nope")).rejects.toBeInstanceOf(DaemonClientError);
    try {
      await client.sessionGet("nope");
    } catch (e) {
      expect((e as DaemonClientError).code).toBe("not_found");
    }
  });

  test("events push to subscribed connections only", async () => {
    const observer = await DaemonClient.connect({ home });
    const seen: string[] = [];
    observer.onEvent((e) => seen.push(e.event));
    await observer.subscribe();
    const s = await client.sessionCreate(WS, PLAN);
    await client.sessionResolve(s.id, "approve", "");
    // events are pushed async over the socket; give the loop a beat
    await Bun.sleep(50);
    expect(seen).toContain("session.created");
    expect(seen).toContain("session.resolved");
    observer.close();
  });

  test("two clients see the same state (thin-renderer model)", async () => {
    const second = await DaemonClient.connect({ home });
    const s = await client.sessionCreate(WS, PLAN);
    const fromSecond = await second.sessionGet(s.id);
    expect(fromSecond.artifact.content).toBe(PLAN.content);
    second.close();
  });
});
