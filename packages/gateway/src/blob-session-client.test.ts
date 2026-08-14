import { beforeEach, describe, expect, test } from "bun:test";
import type { Annotation, ReviewSession } from "@cueloop/schema";
import { packSessionBlob, unpackSessionBlob } from "@cueloop/daemon/share-blob";
import { BlobSessionClient, type ShareWriteBack } from "./blob-session-client";
import { generateMasterKey, openBlob, sealBlob } from "./crypto";
import { MemoryShareStore } from "./store";

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
    revisions: [{ revision: 1, content: "# Plan\n\nthing\n", submittedAt: "2026-01-01T00:00:00.000Z" }],
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
    await store.put("p_abc123xy", sealBlob(masterKey, "p_abc123xy", packSessionBlob(sessionWith([PLANNER_NOTE]))));
    writeBack = { store, masterKey, shareId: "p_abc123xy", author: "SHA256:collab", now: () => "2026-02-02T00:00:00.000Z" };
  });

  async function storedSession(): Promise<ReviewSession> {
    return unpackSessionBlob(openBlob(writeBack.masterKey, "p_abc123xy", (await store.get("p_abc123xy"))!));
  }

  test("a new note unions in, stamped with the author, planner's untouched", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act
    const after = await client.sessionAnnotate("ses_1", NOTE("a_collab", "looks risky"));

    // Assert
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(["a_planner", "a_collab"]);
    expect(after.annotations.find((annotation) => annotation.id === "a_collab")?.author).toBe("SHA256:collab");
    expect(after.annotations.find((annotation) => annotation.id === "a_planner")?.author).toBeUndefined();
    // persisted, not just in memory
    expect((await storedSession()).annotations.map((annotation) => annotation.id)).toEqual(["a_planner", "a_collab"]);
  });

  test("editing their own note rewrites it in place", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);
    await client.sessionAnnotate("ses_1", NOTE("a_collab", "first"));

    // Act
    const after = await client.sessionAnnotate("ses_1", NOTE("a_collab", "second"));

    // Assert
    expect(after.annotations.find((annotation) => annotation.id === "a_collab")?.body).toBe("second");
  });

  test("cannot change or delete the planner's note", async () => {
    // Arrange
    const client = new BlobSessionClient(sessionWith([PLANNER_NOTE]), writeBack);

    // Act / Assert
    await expect(client.sessionAnnotate("ses_1", NOTE("a_planner", "hijack"))).rejects.toThrow(/another author/);
    await expect(client.sessionRemoveAnnotation("ses_1", "a_planner")).rejects.toThrow(/another author/);
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
});
