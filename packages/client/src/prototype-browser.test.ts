import { describe, expect, test } from "bun:test";
import { cssBoxToCell, imageCellToCss } from "./prototype-browser";

const IMAGE = { x: 1, y: 1, width: 80, height: 40 };
const VIEWPORT = { width: 1280, height: 720 };

describe("imageCellToCss", () => {
  test("maps a cell inside the image to the center of its viewport pixel band", () => {
    // Act - the image's top-left cell (1,1)
    const css = imageCellToCss({ x: 1, y: 1 }, IMAGE, VIEWPORT)!;

    // Assert - half a cell into the first band
    expect(css.x).toBeCloseTo((0.5 / 80) * 1280, 5);
    expect(css.y).toBeCloseTo((0.5 / 40) * 720, 5);
  });

  test("a click below the image's origin lands deeper in the page", () => {
    // Act
    const top = imageCellToCss({ x: 40, y: 2 }, IMAGE, VIEWPORT)!;
    const bottom = imageCellToCss({ x: 40, y: 38 }, IMAGE, VIEWPORT)!;

    // Assert
    expect(bottom.y).toBeGreaterThan(top.y);
  });

  test("a cell outside the image returns null", () => {
    // Assert - the gutter left of and the row above the image
    expect(imageCellToCss({ x: 0, y: 10 }, IMAGE, VIEWPORT)).toBeNull();
    expect(imageCellToCss({ x: 10, y: 0 }, IMAGE, VIEWPORT)).toBeNull();
    expect(imageCellToCss({ x: 200, y: 10 }, IMAGE, VIEWPORT)).toBeNull();
  });
});

describe("cssBoxToCell", () => {
  test("maps a viewport rect back to the image cells covering it", () => {
    // Arrange - a rect covering the right half, lower half of the page
    const box = { x: 640, y: 360, width: 320, height: 180 };

    // Act
    const cell = cssBoxToCell(box, IMAGE, VIEWPORT);

    // Assert - x at half width -> 40 cells in from the image origin (1)
    expect(cell.column).toBe(1 + Math.floor((640 / 1280) * 80));
    expect(cell.row).toBe(1 + Math.floor((360 / 720) * 40));
    expect(cell.columns).toBe(Math.round((320 / 1280) * 80));
    expect(cell.rows).toBe(Math.round((180 / 720) * 40));
  });

  test("a zero-size rect still reserves at least one cell", () => {
    // Assert
    const cell = cssBoxToCell({ x: 0, y: 0, width: 0, height: 0 }, IMAGE, VIEWPORT);
    expect(cell.columns).toBe(1);
    expect(cell.rows).toBe(1);
  });
});
