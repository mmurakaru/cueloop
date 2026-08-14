import { describe, expect, test } from "bun:test";
import { MemoryShareStore, r2StoreFromEnv } from "./store";

describe(MemoryShareStore, () => {
  test("get returns the bytes a matching put stored", async () => {
    // Arrange
    const store = new MemoryShareStore();
    const bytes = new Uint8Array([1, 2, 3]);

    // Act
    await store.put("p_abc123xy", bytes);

    // Assert
    expect(await store.get("p_abc123xy")).toEqual(bytes);
  });

  test("get returns null for an unknown id", async () => {
    // Act / Assert
    expect(await new MemoryShareStore().get("p_missing0")).toBeNull();
  });
});

describe(r2StoreFromEnv, () => {
  test("fails fast and names the missing credential", () => {
    // Act / Assert
    expect(() => r2StoreFromEnv({})).toThrow(/CUELOOP_R2_ENDPOINT/);
  });
});
