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

/** Prefix beats substring beats subsequence. */
export function slashFilter(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.toLowerCase();

  if (needle.length === 0) return items;
  const scored: Array<{ item: SlashItem; score: number }> = [];

  for (const item of items) {
    const name = item.name.toLowerCase();
    let score = 0;

    if (name.startsWith(needle)) score = 3;
    else if (name.includes(needle)) score = 2;
    else {
      let matched = 0;

      for (const character of name) {
        if (character === needle[matched]) matched++;
      }
      if (matched === needle.length) score = 1;
    }
    if (score > 0) scored.push({ item, score });
  }

  return scored.toSorted((left, right) => right.score - left.score).map((entry) => entry.item);
}

/**
 * A skill invoked mid-sentence: the trailing "/word" token when text already
 * precedes it (a draft that starts with "/" is the palette, not an inline
 * completion). Newline-safe, since the token may sit at the start of a new line.
 */
export function inlineSlashToken(text: string): string | null {
  if (text.startsWith("/")) return null;
  const match = /(?:^|\s)(\/[a-zA-Z0-9-]*)$/.exec(text);

  return match ? match[1]! : null;
}

export interface InlineSlash {
  token: string;
  suggestion: SlashItem;
}

/** The inline completion state: the trailing "/word" and its closest skill, or null. */
export function resolveInlineSuggestion(
  slashActive: boolean,
  text: string,
  quickActions: QuickAction[],
): InlineSlash | null {
  if (slashActive) return null;
  const token = inlineSlashToken(text);

  if (token === null) return null;
  const suggestion = slashFilter(slashItemsFrom(quickActions), token.slice(1))[0];

  return suggestion ? { token, suggestion } : null;
}
