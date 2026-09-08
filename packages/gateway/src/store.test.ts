import { describe, expect, test } from "bun:test";
import {
  isExpired,
  MemoryShareStore,
  WatchedShareStore,
  r2StoreFromEnv,
  SHARE_TTL_MS,
} from "./store";

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

  test("a blob is gone once the TTL has elapsed", async () => {
    // Arrange
    let now = 1_000_000;
    const store = new MemoryShareStore(() => now);

    await store.put("p_expires0", new Uint8Array([9]));

    // Act: jump just past the retention window
    now += SHARE_TTL_MS;

    // Assert
    expect(await store.get("p_expires0")).toBeNull();
  });

  test("a blob just inside the TTL is still returned", async () => {
    // Arrange
    let now = 1_000_000;
    const store = new MemoryShareStore(() => now);
    const bytes = new Uint8Array([7]);

    await store.put("p_fresh000", bytes);

    // Act: one millisecond short of the window
    now += SHARE_TTL_MS - 1;

    // Assert
    expect(await store.get("p_fresh000")).toEqual(bytes);
  });

  test("a fresh write restarts the retention window", async () => {
    // Arrange
    let now = 1_000_000;
    const store = new MemoryShareStore(() => now);

    await store.put("p_renewed0", new Uint8Array([1]));

    // Act: nearly expire, then rewrite (a revision push)
    now += SHARE_TTL_MS - 1;
    const revised = new Uint8Array([2]);

    await store.put("p_renewed0", revised);
    now += SHARE_TTL_MS - 1;

    // Assert: still reachable because the second write reset the clock
    expect(await store.get("p_renewed0")).toEqual(revised);
  });
});

describe(isExpired, () => {
  test("is exclusive at the boundary and inclusive past it", () => {
    // Assert
    expect(isExpired(0, SHARE_TTL_MS - 1)).toBe(false);
    expect(isExpired(0, SHARE_TTL_MS)).toBe(true);
  });
});

describe(r2StoreFromEnv, () => {
  test("fails fast and names the missing credential", () => {
    // Act / Assert
    expect(() => r2StoreFromEnv({})).toThrow(/CUELOOP_R2_ENDPOINT/);
  });
});

describe("WatchedShareStore", () => {
  test("notifies the subscribers of that id after a put, and stops after unsubscribe", async () => {
    // Arrange
    const store = new WatchedShareStore(new MemoryShareStore());
    const heard: string[] = [];
    const stop = store.subscribe("p_one", () => heard.push("one"));

    store.subscribe("p_two", () => heard.push("two"));

    // Act
    await store.put("p_one", new Uint8Array([1]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert: only p_one's listener, and the bytes are stored
    expect(heard).toEqual(["one"]);
    expect(await store.get("p_one")).toEqual(new Uint8Array([1]));

    // Act
    stop();
    await store.put("p_one", new Uint8Array([2]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(heard).toEqual(["one"]);
  });
});
