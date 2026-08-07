/**
 * Note naming: title from the plan's first H1, sanitized for filesystems,
 * formatted through the configured pattern, never overwriting an existing
 * note (collision suffixes " 2", " 3", ...).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type Separator = "space" | "dash" | "underscore";

const SEPARATOR_CHAR: Record<Separator, string> = { space: " ", dash: "-", underscore: "_" };

/** Characters that break filenames or Obsidian links. */
const FORBIDDEN = /[<>:"/\\|?*(){}[\]#~`]/g;

/** Sanitize a raw title for use as a filesystem name; never empty. */
export function sanitizeTitle(raw: string): string {
  const clean = raw.replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
  const capped = clean.slice(0, 50).trim();
  return capped || "untitled";
}

/** Title = first H1 of the content, else the fallback, sanitized. */
export function titleFrom(content: string, fallback?: string): string {
  const h1 = content.match(/^#[ \t]+(.+)$/m)?.[1];
  return sanitizeTitle(h1 ?? fallback ?? "untitled");
}

/**
 * Render the filename pattern ({YYYY}, {MM}, {DD}, {title}); each whitespace
 * run in the result becomes the configured separator.
 */
export function formatFilename(format: string, title: string, date: Date, separator: Separator = "space"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = format
    .replaceAll("{YYYY}", String(date.getFullYear()))
    .replaceAll("{MM}", pad(date.getMonth() + 1))
    .replaceAll("{DD}", pad(date.getDate()))
    .replaceAll("{title}", title);
  return name.replace(/\s+/g, SEPARATOR_CHAR[separator]);
}

/** First free path for base.md in dir: base.md, base 2.md, base 3.md, ... */
export function uniquePath(dir: string, base: string): string {
  let candidate = join(dir, `${base}.md`);
  for (let n = 2; existsSync(candidate); n++) {
    candidate = join(dir, `${base} ${n}.md`);
  }
  return candidate;
}
