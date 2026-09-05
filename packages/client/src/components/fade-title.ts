/**
 * Fits a thread title onto one line, fading the last few characters toward the
 * background instead of cutting hard or wrapping - a gradient mask on the right.
 * Returns colored segments the caller renders as spans.
 */

export interface TitleSegment {
  text: string;
  fg: string;
}

function channel(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

/** Blend two #rrggbb colors; t=0 is `from`, t=1 is `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const parts = [1, 3, 5].map((start) => {
    const value = Math.round(
      channel(from, start) + (channel(to, start) - channel(from, start)) * clamp,
    );

    return value.toString(16).padStart(2, "0");
  });

  return `#${parts.join("")}`;
}

/** The tail length that fades out; kept short so most of the title stays legible. */
const FADE_WIDTH = 5;

export function fadeTitle(
  title: string,
  maxWidth: number,
  baseColor: string,
  fadeColor: string,
): TitleSegment[] {
  const oneLine = title.replace(/\n/g, " ");

  if (maxWidth <= 0) return [];
  if (oneLine.length <= maxWidth) return [{ text: oneLine, fg: baseColor }];

  const clipped = oneLine.slice(0, maxWidth);
  const fadeLength = Math.min(FADE_WIDTH, maxWidth);
  const head = clipped.slice(0, maxWidth - fadeLength);
  const segments: TitleSegment[] = head.length > 0 ? [{ text: head, fg: baseColor }] : [];

  for (let index = 0; index < fadeLength; index++) {
    // the last character reaches the background fully, so the tail masks out
    // rather than leaving a legible word fragment
    const progress = (index + 1) / fadeLength;

    segments.push({
      text: clipped[maxWidth - fadeLength + index]!,
      fg: mixHex(baseColor, fadeColor, progress),
    });
  }

  return segments;
}
