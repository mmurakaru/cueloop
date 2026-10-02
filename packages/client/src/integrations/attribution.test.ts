import { describe, expect, test } from "bun:test";
import type { Identity } from "@cueloop/schema";
import { ANONYMOUS_LABEL, resolveDisplayName, shortHandle } from "./attribution";

describe(shortHandle, () => {
  test("shortens an ssh fingerprint to a stable handle", () => {
    // Arrange / Act / Assert
    expect(shortHandle("SHA256:1a2b3c4d5e6f")).toBe("1a2b3c4d");
    expect(shortHandle("SHA256:1a2b3c4d5e6f")).toBe(shortHandle("SHA256:1a2b3c4d5e6f"));
  });
});

describe(resolveDisplayName, () => {
  const named: Identity[] = [{ id: "SHA256:abc", provider: "ssh", name: "Al" }];
  const unnamed: Identity[] = [{ id: "SHA256:abc", provider: "ssh" }];

  test("a local rename override wins over everything", () => {
    // Arrange / Act
    const label = resolveDisplayName("SHA256:abc", named, { "SHA256:abc": "Alex" });

    // Assert
    expect(label).toBe("Alex");
  });

  test("falls back to name, then anonymous, then the short handle", () => {
    // Arrange / Act / Assert
    expect(resolveDisplayName("SHA256:abc", named, {})).toBe("Al");
    expect(resolveDisplayName("SHA256:abc", unnamed, {})).toBe(ANONYMOUS_LABEL);
    expect(resolveDisplayName("SHA256:1a2b3c4d5e", [], {})).toBe("1a2b3c4d");
  });
});
