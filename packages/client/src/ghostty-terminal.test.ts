/** The libghostty-vt FFI wrapper round-trips VT: fed bytes come back as decoded cells with colors and attributes. Skipped where no prebuilt dylib ships for the platform. */

import { describe, expect, test } from "bun:test";
import { loadGhosttyTerminals } from "./ghostty-terminal";

const factory = loadGhosttyTerminals();

describe("ghostty-terminal FFI", () => {
  test("reports platform support without throwing", () => {
    // Assert - null on unsupported platforms, a factory where a dylib ships
    expect(factory === null || factory.create !== undefined).toBe(true);
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

  test.skipIf(!factory)(
    "preserves the native screen contract across resize and styled text",
    () => {
      // Arrange
      const term = factory!.create(8, 2)!;

      // Act - resize first, then write RGB colors, every supported style, and a wide glyph
      term.resize(6, 3);
      term.write(
        new TextEncoder().encode(
          "\x1b[38;2;12;34;56;48;2;78;90;123;1;3;4;7;9mA\x1b[0m\x1b[2mF\x1b[0m\u754c",
        ),
      );

      // Assert - the flat native ABI retains cell data and rejects coordinates outside the viewport
      expect(term.readCell(0, 0)).toEqual({
        codepoint: 0x41,
        fg: { kind: "rgb", r: 12, g: 34, b: 56 },
        bg: { kind: "rgb", r: 78, g: 90, b: 123 },
        width: 0,
        bold: true,
        italic: true,
        underline: true,
        inverse: true,
        faint: false,
        strikethrough: true,
      });
      expect(term.readCell(1, 0)?.faint).toBe(true);
      expect(term.readCell(2, 0)?.codepoint).toBe("\u754c".codePointAt(0));
      expect(term.readCell(2, 0)?.width).toBe(1);
      expect(term.readCell(3, 0)?.width).toBe(2);
      expect(term.readCell(6, 0)).toBeNull();
      expect(term.readCell(0, 3)).toBeNull();
      term.free();
    },
  );
});
