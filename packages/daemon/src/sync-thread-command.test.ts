import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore } from "./api";
import { applySyncThreadCommand } from "./sync-thread-command";

test("synchronized commands retain branch history and verified attribution without mutating the source Thread", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-thread-command-"));
  const owner = new DaemonCore(home);

  try {
    const initial = owner.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Original plan", meta: {} },
    });

    owner.sessionBranch(initial.id, "proposal");
    owner.sessionSetWorkingCopy(initial.id, "Reviewed plan");
    const source = structuredClone(owner.sessionGet(initial.id));
    const snapshot = structuredClone(source);
    const result = applySyncThreadCommand({
      thread: source,
      method: "session.annotate",
      parameters: {
        id: source.id,
        annotation: {
          id: "shared-comment",
          kind: "comment",
          author: "forged-owner",
          anchor: { quote: "Reviewed", prefix: "", suffix: " plan" },
          body: "Keep this detail",
        },
      },
      principal: { actorIdentifier: "verified-editor", role: "editor" },
    });

    expect(result.resultThread?.annotations[0]).toMatchObject({
      id: "shared-comment",
      author: "verified-editor",
    });
    expect(
      result.resultThread?.history?.entries.slice(0, snapshot.history?.entries.length),
    ).toEqual(snapshot.history?.entries);
    expect(source).toEqual(snapshot);
    expect(owner.sessionGet(source.id)).toEqual(snapshot);
    expect(
      result.events.some(
        (event) => event.event === "session.updated" && event.sessionId === source.id,
      ),
    ).toBe(true);
    expect(result.threads).toHaveLength(1);
  } finally {
    owner.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("only owners send final Messages and repeated native operation identities preserve their original Message", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-thread-message-"));
  const owner = new DaemonCore(home);

  try {
    const source = owner.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Original plan", meta: {} },
    });
    const command = {
      thread: source,
      method: "session.sendMessage" as const,
      parameters: {
        id: source.id,
        outcome: "comment",
        summary: "Owner message",
        operationId: "existing-native-operation",
      },
    };

    expect(() =>
      applySyncThreadCommand({
        ...command,
        principal: { actorIdentifier: "editor", role: "editor" },
      }),
    ).toThrow("not permitted");
    const first = applySyncThreadCommand({
      ...command,
      principal: { actorIdentifier: "owner", role: "owner" },
    });

    if (!first.resultThread)
      throw new Error("Sync Thread Message test requires its accepted Thread");

    const repeated = applySyncThreadCommand({
      ...command,
      thread: first.resultThread,
      principal: { actorIdentifier: "owner", role: "owner" },
    });

    expect(repeated.resultThread?.message?.id).toBe(first.resultThread.message?.id);
    expect(repeated.resultThread?.history).toEqual(first.resultThread.history);
    expect(repeated.resultThread?.messageOperations).toHaveLength(1);
    expect(repeated.events).toEqual([]);
  } finally {
    owner.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("synchronized editors cannot claim another participant's comment and viewers cannot create comments", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-thread-permissions-"));
  const owner = new DaemonCore(home);

  try {
    const source = owner.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Original plan", meta: {} },
    });
    const annotation = {
      id: "owner-comment",
      kind: "comment" as const,
      author: "owner",
      anchor: { quote: "Original", prefix: "", suffix: " plan" },
      body: "Keep this feedback",
    };

    owner.sessionAnnotate(source.id, annotation);
    const snapshot = structuredClone(owner.sessionGet(source.id));

    expect(() =>
      applySyncThreadCommand({
        thread: snapshot,
        method: "session.annotate",
        parameters: {
          id: source.id,
          annotation: { ...annotation, author: "editor", body: "Replaced feedback" },
        },
        principal: { actorIdentifier: "editor", role: "editor" },
      }),
    ).toThrow("belongs to another");
    expect(() =>
      applySyncThreadCommand({
        thread: snapshot,
        method: "session.removeAnnotation",
        parameters: { id: source.id, annotationId: annotation.id },
        principal: { actorIdentifier: "editor", role: "editor" },
      }),
    ).toThrow("cannot remove");
    expect(() =>
      applySyncThreadCommand({
        thread: snapshot,
        method: "session.annotate",
        parameters: { id: source.id, annotation: { ...annotation, id: "viewer-comment" } },
        principal: { actorIdentifier: "viewer", role: "viewer" },
      }),
    ).toThrow("not permitted");
    expect(owner.sessionGet(source.id)).toEqual(snapshot);
  } finally {
    owner.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});
