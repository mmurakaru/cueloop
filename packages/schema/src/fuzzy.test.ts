import { describe, expect, test } from "bun:test";
import { fuzzyFindBestMatch, levenshteinDistance, similarityRatio } from "./fuzzy";

describe("levenshteinDistance", () => {
  test("identical strings cost nothing", () => {
    // Arrange / Act / Assert
    expect(levenshteinDistance("anchor", "anchor")).toBe(0);
  });

  test("counts a single substitution", () => {
    // Arrange / Act / Assert
    expect(levenshteinDistance("plan", "plane")).toBe(1);
  });

  test("empty against non-empty costs the whole length", () => {
    // Arrange / Act / Assert
    expect(levenshteinDistance("", "quote")).toBe(5);
  });

  test("is symmetric", () => {
    // Arrange / Act / Assert
    expect(levenshteinDistance("kitten", "sitting")).toBe(levenshteinDistance("sitting", "kitten"));
  });
});

describe("similarityRatio", () => {
  test("two empty strings are identical", () => {
    // Arrange / Act / Assert
    expect(similarityRatio("", "")).toBe(1);
  });

  test("identical strings score one", () => {
    // Arrange / Act / Assert
    expect(similarityRatio("review", "review")).toBe(1);
  });

  test("a one-character typo in a long string stays close to one", () => {
    // Arrange
    const original = "demonstration plan";

    // Act
    const ratio = similarityRatio(original, "demonstration plann");

    // Assert
    expect(ratio).toBeGreaterThan(0.9);
  });

  test("unrelated strings score low", () => {
    // Arrange / Act / Assert
    expect(similarityRatio("abcdef", "zyxwvu")).toBeLessThan(0.2);
  });
});

describe("fuzzyFindBestMatch", () => {
  test("finds a lightly edited window and reports its offsets", () => {
    // Arrange
    const haystack = "the quick brown fox jumps";

    // Act
    const match = fuzzyFindBestMatch("quikc brown", haystack, 0.75)!;

    // Assert
    expect(match).not.toBeNull();
    expect(haystack.slice(match.start, match.end)).toBe("quick brown");
    expect(match.similarity).toBeGreaterThan(0.75);
  });

  test("returns null when nothing clears the similarity floor", () => {
    // Arrange / Act
    const match = fuzzyFindBestMatch("completely unrelated", "short text", 0.75);

    // Assert
    expect(match).toBeNull();
  });

  test("an empty needle or haystack never matches", () => {
    // Arrange / Act / Assert
    expect(fuzzyFindBestMatch("", "text", 0.75)).toBeNull();
    expect(fuzzyFindBestMatch("text", "", 0.75)).toBeNull();
  });

  test("ties keep the earliest window", () => {
    // Arrange
    const haystack = "word word";

    // Act
    const match = fuzzyFindBestMatch("word", haystack, 0.9)!;

    // Assert
    expect(match.start).toBe(0);
  });
});
