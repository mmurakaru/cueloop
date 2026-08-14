import { describe, expect, test } from "bun:test";
import { SHARE_PREFIX, isShareId, mintShareId } from "./share-id";

describe(mintShareId, () => {
  test("mints a p_ + 8 char id that reads back as a share id", () => {
    // Act
    const id = mintShareId();

    // Assert
    expect(id).toMatch(/^p_[A-Za-z0-9]{8}$/);
    expect(isShareId(id)).toBe(true);
  });

  test("mints distinct ids across many draws", () => {
    // Arrange
    const ids = new Set<string>();

    // Act
    for (let index = 0; index < 1000; index++) ids.add(mintShareId());

    // Assert
    expect(ids.size).toBe(1000);
  });
});

describe(isShareId, () => {
  for (const { note, value, expected } of [
    { note: "a minted id", value: mintShareId(), expected: true },
    { note: "the upload username", value: "share", expected: false },
    { note: "wrong length", value: `${SHARE_PREFIX}abc`, expected: false },
    { note: "a non-base62 char", value: `${SHARE_PREFIX}abcd-fgh`, expected: false },
    { note: "no prefix", value: "7f3k9x2q", expected: false },
  ]) {
    test(note, () => {
      // Assert
      expect(isShareId(value)).toBe(expected);
    });
  }
});
