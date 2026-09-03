import { beforeEach, describe, expect, test } from "bun:test";
import type { Annotation, ReviewSession } from "@cueloop/schema";
import { packSessionBlob, unpackSessionBlob } from "@cueloop/daemon/share-blob";
import { BlobSessionClient, type ShareWriteBack } from "./blob-session-client";
import { generateMasterKey, openBlob, sealBlob } from "./crypto";
import { MemoryShareStore, WatchedShareStore } from "./store";

const PLANNER_NOTE: Annotation = {
  id: "a_planner",
  kind: "comment",
  anchor: { quote: "thing", prefix: "", suffix: "" },
  body: "planner asks why",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function sessionWith(annotations: Annotation[]): ReviewSession {
  return {
    schemaVersion: "1",
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n\nthing\n", meta: {} },
    revisions: [
      { revision: 1, content: "# Plan\n\nthing\n", submittedAt: "2026-01-01T00:00:00.000Z" },
    ],
    annotations,
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const NOTE = (id: string, body: string): Omit<Annotation, "createdAt"> => ({
  id,
  kind: "comment",
  anchor: { quote: "thing", prefix: "", suffix: "" },
  body,
});

describe("read-only viewer (no write-back)", () => {
  const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]));

  test("sessionGet returns the blob-held session", async () => {
    // Assert
    expect((await client.sessionGet("x")).id).toBe("ses_1");
  });

  test("every mutation rejects", async () => {
    // Assert
    await expect(client.sessionAnnotate("ses_1", NOTE("a_1", "hi"))).rejects.toThrow(/read-only/);
    await expect(client.sessionResolve()).rejects.toThrow();
  });
});

describe("collaborator write-back", () => {
  let store: MemoryShareStore;
  let writeBack: ShareWriteBack;

  beforeEach(async () => {
    const masterKey = generateMasterKey();

    store = new MemoryShareStore();
    // seed the store with the planner's blob, as an upload would have
    await store.put(
      "p_abc123xy",
      sealBlob(masterKey, "p_abc123xy", packSessionBlob(sessionWith([PLANNER_NOTE]))),
    );
    writeBack = {
      store,
      masterKey,
      shareId: "p_abc123xy",
      author: "SHA256:collab",
      now: () => "2026-02-02T00:00:00.000Z",
    };
  });

  async function storedSession(): Promise<ReviewSession> {
    return unpackSessionBlob(
      openBlob(writeBack.masterKey, "p_abc123xy", (await store.get("p_abc123xy"))!),
    );
  }

  test("a new note unions in, stamped with the author, planner's untouched", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act
    const after = await client.sessionAnnotate("ses_1", NOTE("a_collab", "looks risky"));

    // Assert
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(["a_planner", "a_collab"]);
    expect(after.annotations.find((annotation) => annotation.id === "a_collab")?.author).toBe(
      "SHA256:collab",
    );
    expect(
      after.annotations.find((annotation) => annotation.id === "a_planner")?.author,
    ).toBeUndefined();
    // persisted, not just in memory
    expect((await storedSession()).annotations.map((annotation) => annotation.id)).toEqual([
      "a_planner",
      "a_collab",
    ]);
  });

  test("editing their own note rewrites it in place", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    await client.sessionAnnotate("ses_1", NOTE("a_collab", "first"));

    // Act
    const after = await client.sessionAnnotate("ses_1", NOTE("a_collab", "second"));

    // Assert
    expect(after.annotations.find((annotation) => annotation.id === "a_collab")?.body).toBe(
      "second",
    );
  });

  test("cannot change or delete the planner's note", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act / Assert
    await expect(client.sessionAnnotate("ses_1", NOTE("a_planner", "hijack"))).rejects.toThrow(
      /another author/,
    );
    await expect(client.sessionRemoveAnnotation("ses_1", "a_planner")).rejects.toThrow(
      /another author/,
    );
  });

  test("can delete their own note", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    await client.sessionAnnotate("ses_1", NOTE("a_collab", "note"));

    // Act
    const after = await client.sessionRemoveAnnotation("ses_1", "a_collab");

    // Assert
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(["a_planner"]);
  });

  test("self-naming records the collaborator's identity in the participant registry", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act
    const after = await client.sessionSetSelfName("ses_1", "  Robin  ");

    // Assert
    expect(after.participants).toEqual([{ id: "SHA256:collab", provider: "ssh", name: "Robin" }]);
    expect((await storedSession()).participants).toEqual([
      { id: "SHA256:collab", provider: "ssh", name: "Robin" },
    ]);
  });

  test("leaving a note registers the author anonymously so they never read as a raw fingerprint", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act
    const after = await client.sessionAnnotate("ses_1", NOTE("a_collab", "no name given"));

    // Assert
    expect(after.participants).toEqual([{ id: "SHA256:collab", provider: "ssh" }]);
  });

  test("naming after annotating updates the same participant entry", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    await client.sessionAnnotate("ses_1", NOTE("a_collab", "note first"));

    // Act
    const after = await client.sessionSetSelfName("ses_1", "Robin");

    // Assert
    expect(after.participants).toEqual([{ id: "SHA256:collab", provider: "ssh", name: "Robin" }]);
  });

  test("annotating after naming keeps the name, does not reset to anonymous", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    await client.sessionSetSelfName("ses_1", "Robin");

    // Act
    const after = await client.sessionAnnotate("ses_1", NOTE("a_collab", "note after"));

    // Assert
    expect(after.participants).toEqual([{ id: "SHA256:collab", provider: "ssh", name: "Robin" }]);
  });

  test("self-naming again updates the existing entry, not a duplicate", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    await client.sessionSetSelfName("ses_1", "Robin");

    // Act
    const after = await client.sessionSetSelfName("ses_1", "Robin H.");

    // Assert
    expect(after.participants).toEqual([
      { id: "SHA256:collab", provider: "ssh", name: "Robin H." },
    ]);
  });

  test("an empty name registers the fingerprint without a name - anonymous", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act
    const after = await client.sessionSetSelfName("ses_1", "   ");

    // Assert
    expect(after.participants).toEqual([{ id: "SHA256:collab", provider: "ssh" }]);
  });
});

describe("live events", () => {
  test("a subscribed viewer hears another writer's change and serves the fresh session", async () => {
    // Arrange: two collaborators on one watched store
    const masterKey = generateMasterKey();
    const store = new WatchedShareStore(new MemoryShareStore());

    await store.put(
      "p_abc123xy",
      sealBlob(masterKey, "p_abc123xy", packSessionBlob(sessionWith([PLANNER_NOTE]))),
    );
    const writeBackFor = (author: string): ShareWriteBack => ({
      store,
      masterKey,
      shareId: "p_abc123xy",
      author,
      changes: store,
    });
    const ana = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBackFor("SHA256:ana"));
    const bob = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBackFor("SHA256:bob"));
    const events: string[] = [];

    ana.onEvent((event) => events.push(`${event.event}:${event.sessionId}`));
    await ana.subscribe();

    // Act
    await bob.sessionAnnotate("ses_1", NOTE("a_bob", "from bob"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert: Ana was told, and her next read already holds Bob's note
    expect(events).toEqual(["session.updated:ses_1"]);
    expect((await ana.sessionGet("ses_1")).annotations.map((note) => note.id)).toEqual([
      "a_planner",
      "a_bob",
    ]);

    // Act: closing unsubscribes
    ana.close();
    await bob.sessionAnnotate("ses_1", NOTE("a_bob2", "again"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(events).toHaveLength(1);
  });

  test("without a change feed the viewer stays silent", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]));
    const events: string[] = [];

    client.onEvent((event) => events.push(event.event));

    // Act
    await client.subscribe();

    // Assert
    expect(events).toEqual([]);
  });
});
