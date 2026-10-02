import { describe, expect, test } from "bun:test";
import { ansiScreenToLines } from "./ansi-screen";

describe("ansiScreenToLines", () => {
  test("places text at the positioned cursor", () => {
    const lines = ansiScreenToLines("\x1b[2;3Hhi", 10, 4);

    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("  hi");
    expect(lines[2]).toBe("");
  });

  test("clears the screen before repositioning", () => {
    const lines = ansiScreenToLines("\x1b[1;1Hold\x1b[2J\x1b[1;1Hnew", 10, 2);

    expect(lines[0]).toBe("new");
  });

  test("ignores colour, cursor-visibility, and clipboard sequences", () => {
    const lines = ansiScreenToLines("\x1b[?25l\x1b[1;1H\x1b[32mgo\x1b]52;c;AA\x07", 10, 2);

    expect(lines[0]).toBe("go");
  });

  test("clamps writes outside the grid instead of throwing", () => {
    expect(() => ansiScreenToLines("\x1b[99;99Hx", 5, 3)).not.toThrow();
  });
});
