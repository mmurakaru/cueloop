import { describe, expect, test } from "bun:test";
import type { ReviewSession } from "@cueloop/schema";
import { BlobSessionClient } from "./blob-session-client";

const SESSION = { id: "ses_1", annotations: [] } as unknown as ReviewSession;

describe(BlobSessionClient, () => {
  test("sessionGet hands back the blob-held session", async () => {
    // Act
    const got = await new BlobSessionClient(SESSION).sessionGet("ignored");

    // Assert
    expect(got).toBe(SESSION);
  });

  test("mutation verbs reject: the viewer is read-only", async () => {
    // Arrange
    const client = new BlobSessionClient(SESSION);

    // Act / Assert
    await expect(client.sessionResolve()).rejects.toThrow(/read-only/);
    await expect(client.sessionAnnotate()).rejects.toThrow(/read-only/);
  });

  test("subscribe resolves and onEvent never fires", async () => {
    // Arrange
    const client = new BlobSessionClient(SESSION);
    let fired = false;

    // Act
    const unsubscribe = client.onEvent(() => (fired = true));
    await client.subscribe();
    unsubscribe();

    // Assert
    expect(fired).toBe(false);
  });
});
