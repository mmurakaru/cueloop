import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatFilename, sanitizeTitle, titleFrom, uniquePath } from "./filename";

const DATE = new Date("2026-08-07T12:00:00Z");

describe("titleFrom", () => {
  test("uses the first H1", () => {
    expect(titleFrom("intro\n\n# Migration Plan\n\n## Steps\n")).toBe("Migration Plan");
  });

  test("falls back to the provided title, then to untitled", () => {
    expect(titleFrom("no headings here", "Session Title")).toBe("Session Title");
    expect(titleFrom("no headings here")).toBe("untitled");
  });

  test("strips forbidden characters and collapses whitespace", () => {
    expect(titleFrom('# Fix <the> "store": a/b\\c | d?* (v2) {x} [y] #tag ~ `code`')).toBe(
      "Fix the store abc d v2 x y tag code",
    );
  });

  test("caps the title at 50 characters", () => {
    // Arrange
    const long = "# " + "word ".repeat(20);

    // Assert
    expect(titleFrom(long).length).toBeLessThanOrEqual(50);
    expect(titleFrom(long).endsWith(" ")).toBe(false);
  });

  test("a title of only forbidden characters becomes untitled", () => {
    expect(sanitizeTitle("###")).toBe("untitled");
  });
});

describe("formatFilename", () => {
  test("renders date tokens and the title with the space separator", () => {
    expect(formatFilename("{YYYY}-{MM}-{DD} - {title}", "My Plan", DATE, "space")).toBe(
      "2026-08-07 - My Plan",
    );
  });

  test("dash and underscore separators replace whitespace runs", () => {
    expect(formatFilename("{YYYY}-{MM}-{DD} - {title}", "My Plan", DATE, "dash")).toBe(
      "2026-08-07---My-Plan",
    );
    expect(formatFilename("{title}", "My Plan", DATE, "underscore")).toBe("My_Plan");
  });
});

describe("uniquePath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cueloop-obsidian-name-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("appends counting suffixes instead of overwriting", () => {
    // Assert
    expect(uniquePath(dir, "plan")).toBe(join(dir, "plan.md"));

    // Act
    writeFileSync(join(dir, "plan.md"), "");

    // Assert
    expect(uniquePath(dir, "plan")).toBe(join(dir, "plan 2.md"));

    // Act
    writeFileSync(join(dir, "plan 2.md"), "");

    // Assert
    expect(uniquePath(dir, "plan")).toBe(join(dir, "plan 3.md"));
  });
});
