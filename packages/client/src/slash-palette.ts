/**
 * The "/" quick-action palette behind a composer: the skill list a leading
 * slash opens, its prefix > substring > subsequence filter, and the inline
 * "/word" completion offered mid-sentence. Pure; the surfaces render it.
 */

import { quickActionBody, type QuickAction } from "./config";

export interface SlashItem {
  name: string;
  description: string;
  body: string;
}

export function slashItemsFrom(quickActions: QuickAction[]): SlashItem[] {
  return quickActions.map((action) => ({
    name: action.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    description: action.metadata ?? action.prompt,
    body: quickActionBody(action),
  }));
}

const WORD_BOUNDARY = /[\s\-_./:]/;

/** Order-preserving subsequence score, or null when a query character is missing; higher is better. */
export function scoreMatch(name: string, query: string): number | null {
  if (query.length === 0) return 0;
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerName === lowerQuery) return 1000;
  if (lowerName.startsWith(lowerQuery)) return 500 - name.length;
  let score = 0;
  let cursor = 0;
  let run = 0;

  for (const character of lowerQuery) {
    const found = lowerName.indexOf(character, cursor);

    if (found === -1) return null;
    run = found === cursor ? run + 1 : 0;
    score += found === cursor ? 5 + run : 1;
    if (found === 0 || WORD_BOUNDARY.test(lowerName[found - 1]!)) score += 10;
    score -= found - cursor;
    cursor = found + 1;
  }

  return score;
}

export function slashFilter(items: SlashItem[], query: string): SlashItem[] {
  if (query.length === 0) return items;
  const scored: Array<{ item: SlashItem; score: number }> = [];

  for (const item of items) {
    const score = scoreMatch(item.name, query);

    if (score !== null) scored.push({ item, score });
  }

  return scored.toSorted((left, right) => right.score - left.score).map((entry) => entry.item);
}

/**
 * The "/word" token the caret is writing right now: the trailing run since the
 * last whitespace, at the start of the draft or after it. Null once a space
 * closes the token, so each new "/" reopens the palette and skills chain.
 * Newline-safe, since the token may sit at the start of a new line.
 */
export function activeSlashToken(text: string): string | null {
  const match = /(?:^|\s)(\/[a-zA-Z0-9-]*)$/.exec(text);

  return match ? match[1]! : null;
}

/**
 * The character ranges of every completed "/name" in the draft that names a real
 * action or skill, so a surface can paint the references. A half-typed "/na" is
 * not a reference yet, so it stays unpainted until the palette completes it.
 */
export function skillReferenceRanges(
  text: string,
  names: ReadonlySet<string>,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /(?:^|\s)(\/[a-zA-Z0-9-]+)/g;

  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const token = match[1]!;

    if (!names.has(token.slice(1))) continue;
    const start = match.index + match[0].length - token.length;

    ranges.push({ start, end: start + token.length });
  }

  return ranges;
}

/** Quick actions and user skills in one palette; a quick action wins a name collision (it expands). */
export function mergeSlashItems(actions: SlashItem[], skills: SlashItem[]): SlashItem[] {
  const taken = new Set(actions.map((action) => action.name));

  return [...actions, ...skills.filter((skill) => !taken.has(skill.name))];
}
