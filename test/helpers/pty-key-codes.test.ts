/** Key names encode to the bytes a TERM=xterm-256color terminal sends; bad chords fail loudly. */

import { describe, expect, test } from "bun:test";
import { encodePtyKeyPress } from "./pty-key-codes";

describe("encodePtyKeyPress", () => {
  test("names map to their sequences and printables pass through", () => {
    // Given named keys and a letter
    // When encoded
    // Then arrows are CSI, enter is CR, escape is ESC, and the letter is itself
    expect(encodePtyKeyPress("down")).toBe("\x1b[B");
    expect(encodePtyKeyPress("enter")).toBe("\r");
    expect(encodePtyKeyPress("escape")).toBe("\x1b");
    expect(encodePtyKeyPress("f5")).toBe("\x1b[15~");
    expect(encodePtyKeyPress("x")).toBe("x");
  });

  test("ctrl with a letter is the C0 control byte", () => {
    // Given ctrl chords with letters of either case
    // When encoded
    // Then each is letter & 0x1f
    expect(encodePtyKeyPress(["ctrl", "e"])).toBe("\x05");
    expect(encodePtyKeyPress(["ctrl", "Q"])).toBe("\x11");
  });

  test("ctrl with enter or tab uses CSI u, alt prefixes ESC, shift uppercases", () => {
    // Given chords plain bytes cannot express
    // When encoded
    // Then CSI u carries the modifier parameter, alt is an ESC prefix, shift+tab is CSI Z
    expect(encodePtyKeyPress(["ctrl", "enter"])).toBe("\x1b[13;5u");
    expect(encodePtyKeyPress(["ctrl", "shift", "tab"])).toBe("\x1b[9;6u");
    expect(encodePtyKeyPress(["alt", "n"])).toBe("\x1bn");
    expect(encodePtyKeyPress(["alt", "down"])).toBe("\x1b\x1b[B");
    expect(encodePtyKeyPress(["shift", "tab"])).toBe("\x1b[Z");
    expect(encodePtyKeyPress(["shift", "up"])).toBe("\x1b[1;2A");
    expect(encodePtyKeyPress(["shift", "a"])).toBe("A");
  });

  test("multi-character keys and ctrl+arrow are rejected", () => {
    // Given malformed presses
    // When encoded
    // Then each throws with the offending token named
    expect(() => encodePtyKeyPress("dwon")).toThrow(
      '"dwon" is neither a named key nor one character',
    );
    expect(() => encodePtyKeyPress(["ctrl", "down"])).toThrow('cannot send ctrl with "down"');
  });
});
