import { describe, expect, test } from "bun:test";
import { TokenBucket } from "./rate-limit";

describe(TokenBucket, () => {
  test("allows up to capacity, then denies", () => {
    // Arrange
    const bucket = new TokenBucket(2, 1, () => 0);

    // Act / Assert
    expect(bucket.take("ip")).toBe(true);
    expect(bucket.take("ip")).toBe(true);
    expect(bucket.take("ip")).toBe(false);
  });

  test("refills over time", () => {
    // Arrange
    let clock = 0;
    const bucket = new TokenBucket(1, 1, () => clock);

    bucket.take("ip");

    // Act: one second later, one token is back
    clock = 1000;

    // Assert
    expect(bucket.take("ip")).toBe(true);
  });

  test("tracks each source separately", () => {
    // Arrange
    const bucket = new TokenBucket(1, 1, () => 0);

    // Act
    bucket.take("a");

    // Assert
    expect(bucket.take("b")).toBe(true);
  });
});
