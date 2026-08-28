/**
 * Approximate string matching for anchor re-binding. The anchor resolver falls
 * back to these when exact and marker-normalized quote lookups both miss - the
 * quoted text is still present but was lightly edited (a word changed, a typo
 * fixed, punctuation adjusted). Everything here is pure and offset-exact so it
 * can be tested in isolation from the resolver.
 */

/** A window of the haystack that best matches the needle. */
export interface FuzzyMatch {
  /** Inclusive start offset into the haystack. */
  start: number;
  /** Exclusive end offset into the haystack. */
  end: number;
  /** Similarity of the matched window to the needle, in [0, 1]. */
  similarity: number;
}

/**
 * Levenshtein edit distance: the fewest single-character insertions, deletions,
 * or substitutions that turn `left` into `right`. Uses two rolling rows, so it
 * costs O(left.length * right.length) time and O(right.length) space.
 */
export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previousRow: number[] = Array.from({ length: right.length + 1 }, (_unused, column) => column);
  let currentRow: number[] = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    currentRow[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1]! + 1, // insertion
        previousRow[rightIndex]! + 1, // deletion
        previousRow[rightIndex - 1]! + substitutionCost, // substitution
      );
    }
    const swap = previousRow;

    previousRow = currentRow;
    currentRow = swap;
  }

  return previousRow[right.length]!;
}

/**
 * Similarity of two strings in [0, 1]: 1 is identical, 0 shares nothing. Derived
 * from the edit distance normalized by the longer string. Two empty strings are
 * defined as identical (1).
 */
export function similarityRatio(left: string, right: string): number {
  const longestLength = Math.max(left.length, right.length);

  if (longestLength === 0) return 1;

  return 1 - levenshteinDistance(left, right) / longestLength;
}

/**
 * Find the haystack window most similar to the needle, or null when nothing
 * clears `minimumSimilarity`. Windows range around the needle length so the
 * match tolerates a few inserted or deleted characters, not only substitutions.
 * Ties keep the earliest window. Offsets index the haystack directly.
 */
export function fuzzyFindBestMatch(
  needle: string,
  haystack: string,
  minimumSimilarity: number,
): FuzzyMatch | null {
  if (needle === "" || haystack === "") return null;

  const lengthTolerance = Math.max(2, Math.round(needle.length * 0.25));
  const minimumWindowLength = Math.max(1, needle.length - lengthTolerance);
  const maximumWindowLength = needle.length + lengthTolerance;

  let bestMatch: FuzzyMatch | null = null;

  for (let start = 0; start < haystack.length; start++) {
    for (
      let windowLength = minimumWindowLength;
      windowLength <= maximumWindowLength && start + windowLength <= haystack.length;
      windowLength++
    ) {
      const window = haystack.slice(start, start + windowLength);
      const similarity = similarityRatio(needle, window);

      if (similarity < minimumSimilarity) continue;
      if (bestMatch === null || similarity > bestMatch.similarity) {
        bestMatch = { start, end: start + windowLength, similarity };
      }
    }
  }

  return bestMatch;
}
