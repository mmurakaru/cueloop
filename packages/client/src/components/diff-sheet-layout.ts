/**
 * Pure color logic for the diff review sheet, split out so it can be tested
 * without rendering: a row's colored spans (syntax under the intra-line change
 * color). DiffSheet.tsx paints marks and the caret over these per character.
 */

import type { Theme } from "../theme";
import type { IntralineRun } from "../diff-intraline";
import type { SyntaxSpan } from "../diff-syntax";
import { colorForSyntaxGroup } from "./syntax-highlight";

/** One rendered span of a row: its text and its resolved foreground color. */
export interface ColoredSpan {
  text: string;
  foreground: string;
}

/**
 * Colored spans for one row, resolved per character: an intra-line changed word
 * keeps the diff color, otherwise the syntax color applies, falling back to the
 * dim token on the unchanged part of a modified line or the row's base color.
 * Adjacent same-color characters coalesce so a row stays a few spans.
 */
export function coloredRowSpans(
  text: string,
  intralineRuns: IntralineRun[] | undefined,
  syntaxSpans: SyntaxSpan[] | undefined,
  baseColor: string,
  tokens: Theme,
): ColoredSpan[] {
  const changed = changedColumns(text.length, intralineRuns);
  const syntaxColorByColumn = syntaxColorColumns(text.length, syntaxSpans, tokens);
  const isModifiedLine = intralineRuns !== undefined;

  const spans: ColoredSpan[] = [];

  for (let column = 0; column < text.length; column++) {
    const color = changed[column]
      ? baseColor
      : (syntaxColorByColumn[column] ?? (isModifiedLine ? tokens.textDim : baseColor));
    const previous = spans[spans.length - 1];

    if (previous && previous.foreground === color) previous.text += text[column];
    else spans.push({ text: text[column]!, foreground: color });
  }

  return spans;
}

/** Which columns are the intra-line change on a modified line. */
function changedColumns(length: number, intralineRuns: IntralineRun[] | undefined): boolean[] {
  const changed = Array.from({ length }, () => false);

  if (!intralineRuns) return changed;
  let offset = 0;

  for (const run of intralineRuns) {
    if (run.changed)
      for (let index = 0; index < run.text.length; index++) changed[offset + index] = true;
    offset += run.text.length;
  }

  return changed;
}

/** The syntax color per column, or undefined where a column has no token. */
function syntaxColorColumns(
  length: number,
  syntaxSpans: SyntaxSpan[] | undefined,
  tokens: Theme,
): Array<string | undefined> {
  const colors: Array<string | undefined> = Array.from({ length }, () => undefined);

  for (const span of syntaxSpans ?? []) {
    const color = colorForSyntaxGroup(span.group, tokens);

    if (!color) continue;
    for (let column = span.start; column < span.end && column < length; column++) {
      colors[column] = color;
    }
  }

  return colors;
}
