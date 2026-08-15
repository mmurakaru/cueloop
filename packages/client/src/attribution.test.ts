import { describe, expect, test } from "bun:test";
import { authorLabel } from "./attribution";

describe(authorLabel, () => {
  test("shortens an ssh fingerprint to a stable handle", () => {
    // Arrange
    const fingerprint = "SHA256:1a2b3c4d5e6f7g8h";

    // Act
    const label = authorLabel(fingerprint);

    // Assert
    expect(label).toBe("1a2b3c4d");
  });

  test("is deterministic and passes a non-fingerprint author through", () => {
    // Arrange / Act / Assert
    expect(authorLabel("SHA256:zzxxccvvbb")).toBe(authorLabel("SHA256:zzxxccvvbb"));
    expect(authorLabel("alex")).toBe("alex");
  });
});
