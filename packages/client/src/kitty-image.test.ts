/** Kitty emission guards: the image sits beneath painted cells, and every put reuses one placement id so repeated frames REPLACE the placement instead of stacking a new one each frame (the prototype's per-frame lag/ghosting regression). Transmit medium is file locally and base64 over ssh. */

import { describe, expect, test } from "bun:test";
import { placeKittyImage, resolveTransmitMedium, transmitKittyImage } from "./kitty-image";

const REGION = { column: 2, row: 3, columns: 40, rows: 12 };

describe("kitty image placement", () => {
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

  test("every frame reuses one placement id, so repeated puts replace rather than stack", () => {
    // Arrange
    const writes: string[] = [];
    const write = (chunk: string): void => void writes.push(chunk);

    // Act - one transmit then many re-places, as the per-frame paint loop does
    transmitKittyImage(write, new Uint8Array([1]), REGION, 811, "base64");
    for (let frame = 0; frame < 5; frame++) placeKittyImage(write, REGION, 811);

    // Assert - a stable placement id p=1 on the transmit and every place
    expect(writes[0]).toContain("i=811,p=1");
    for (const placement of writes.slice(1)) expect(placement).toContain("i=811,p=1");
  });

  test("base64 transmit chunks the payload; file transmit hands over a path once", () => {
    // Arrange
    const big = new Uint8Array(9000).fill(1);
    const base64Writes: string[] = [];
    const fileWrites: string[] = [];

    // Act
    transmitKittyImage((chunk) => base64Writes.push(chunk), big, REGION, 811, "base64");
    transmitKittyImage((chunk) => fileWrites.push(chunk), big, REGION, 811, "file");

    // Assert - base64 inlines the data (a=T without t=), file references a temp path (t=t)
    expect(base64Writes[0]).toContain("a=T");
    expect(base64Writes[0]).not.toContain("t=t");
    expect(fileWrites[0]).toContain("t=t");
  });
});

describe("resolveTransmitMedium", () => {
  test("defaults to base64; file transfer is opt-in and never over ssh", () => {
    // Assert
    expect(resolveTransmitMedium({} as NodeJS.ProcessEnv)).toBe("base64");
    expect(resolveTransmitMedium({ CUELOOP_KITTY_FILE: "1" } as NodeJS.ProcessEnv)).toBe("file");
    expect(
      resolveTransmitMedium({
        CUELOOP_KITTY_FILE: "1",
        SSH_CONNECTION: "1.2.3.4 5 6 7",
      } as NodeJS.ProcessEnv),
    ).toBe("base64");
  });
});
