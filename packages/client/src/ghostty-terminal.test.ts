/** The libghostty-vt FFI wrapper round-trips VT: fed bytes come back as decoded cells with colors and attributes. Skipped where no prebuilt dylib ships for the platform. */

import { describe, expect, test } from "bun:test";
import { loadGhosttyTerminals } from "./ghostty-terminal";

const factory = loadGhosttyTerminals();

describe("ghostty-terminal FFI", () => {
  test("reports platform support without throwing", () => {
    // Assert - null on unsupported platforms, a factory where a dylib ships
    expect(factory === null || typeof factory.create === "function").toBe(true);
  });

  test.skipIf(!factory)("writes VT bytes and reads back decoded cells", () => {
    // Arrange
    const term = factory!.create(80, 24)!;
    expect(term).not.toBeNull();

    // Act - plain text then bold + palette-green "GO"
    term.write(new TextEncoder().encode("hi\x1b[1;32mGO\x1b[0m"));
    const cells = [0, 1, 2, 3].map((x) => term.readCell(x, 0));

    // Assert - glyphs decode, and the green run is bold on ANSI palette index 2
    expect(
      cells.map((c) => (c?.codepoint ? String.fromCodePoint(c.codepoint) : " ")).join(""),
    ).toBe("hiGO");
    expect(cells[2]!.bold).toBe(true);
    expect(cells[2]!.fg).toEqual({ kind: "palette", index: 2 });
    term.free();
  });

  test.skipIf(!factory)("tracks the cursor position as text is written", () => {
    // Arrange
    const term = factory!.create(80, 24)!;

    // Act
    term.write(new TextEncoder().encode("abc"));

    // Assert - cursor advanced past the three glyphs on row 0
    const cursor = term.readCursor();
    expect(cursor.y).toBe(0);
    expect(cursor.x).toBe(3);
    term.free();
  });
});
