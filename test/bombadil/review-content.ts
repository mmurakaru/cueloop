import { BOMBADIL_DIFF_READY_TITLE, BOMBADIL_PLAN_READY_TITLE } from "./fixture-contract.ts";

export function hasBombadilReviewContent(text: string): boolean {
  if (text.includes(BOMBADIL_DIFF_READY_TITLE)) {
    return /\brecord\d+\b/.test(text);
  }

  return text.includes(BOMBADIL_PLAN_READY_TITLE) && /Navigation sample \d+:/.test(text);
}
