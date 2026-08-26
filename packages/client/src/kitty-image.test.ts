import { describe, expect, test } from "bun:test";
import { placeKittyImage, transmitKittyImage } from "./kitty-image";

const REGION = { column: 2, row: 3, columns: 40, rows: 12 };

describe("kitty image stacking", () => {
  test("places the prototype below cells with painted backgrounds", () => {
    // Arrange
    const writes: string[] = [];

    // Act
    transmitKittyImage((chunk) => writes.push(chunk), new Uint8Array([1]), REGION, 811);
    placeKittyImage((chunk) => writes.push(chunk), REGION, 811);

    // Assert
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain("z=-1073741825");
    expect(writes[1]).toContain("z=-1073741825");
  });
});
