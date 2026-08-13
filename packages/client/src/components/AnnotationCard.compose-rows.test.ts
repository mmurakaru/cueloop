/**
 * The composer's auto-grow row math as a pure function: hard newlines and soft
 * wrapping both add rows, growth stops at the cap, and a non-positive width
 * (before layout is known) degrades to a hard-newline count. The live textarea
 * scrolls internally past the cap, so this only needs to get the growth curve
 * and the ceiling right.
 */

import { describe, expect, test } from "bun:test";
import { COMPOSE_MAX_ROWS, composeRowCount } from "./AnnotationCard";

describe("composeRowCount", () => {
  const width = 10;

  test("empty and short text are one row", () => {
    expect(composeRowCount("", width)).toBe(1);
    expect(composeRowCount("hi", width)).toBe(1);
    expect(composeRowCount("exactly-10", width)).toBe(1); // length 10 / width 10
  });

  test("hard newlines add rows", () => {
    expect(composeRowCount("a\nb", width)).toBe(2);
    expect(composeRowCount("a\nb\nc", width)).toBe(3);
    // a blank trailing line still occupies a row
    expect(composeRowCount("a\n", width)).toBe(2);
  });

  test("a soft-wrapped long line grows the box", () => {
    expect(composeRowCount("a".repeat(11), width)).toBe(2); // ceil(11/10)
    expect(composeRowCount("a".repeat(25), width)).toBe(3); // ceil(25/10)
  });

  test("wrapping and hard newlines combine", () => {
    // 1 row for "short" plus ceil(21/10)=3 rows for the long line
    expect(composeRowCount("short\n" + "b".repeat(21), width)).toBe(4);
  });

  test("growth is capped", () => {
    expect(composeRowCount("a".repeat(100), width)).toBe(COMPOSE_MAX_ROWS);
    expect(composeRowCount("l\ni\nn\ne\ns\nx", width)).toBe(COMPOSE_MAX_ROWS);
    expect(composeRowCount("a\nb", width, 1)).toBe(1); // custom cap
  });

  test("a non-positive width counts hard newlines only, never divides by zero", () => {
    expect(composeRowCount("a".repeat(100), 0)).toBe(1);
    expect(composeRowCount("a\nb\nc", 0)).toBe(3);
    expect(composeRowCount("a".repeat(100), -5)).toBe(1);
  });
});
