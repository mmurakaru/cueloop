import { expect, test } from "bun:test";
import { hasBombadilReviewContent } from "./review-content.ts";

test("a ready header cannot hide an empty or wrong review document", () => {
  expect(hasBombadilReviewContent("cueloop READY P\n\nSend message (0)")).toBe(false);
  expect(hasBombadilReviewContent("cueloop READY D\n\nSend message (0)")).toBe(false);
  expect(hasBombadilReviewContent("READY P\n+export const record0 = 1;")).toBe(false);
  expect(hasBombadilReviewContent("READY D\nNavigation sample 0: text.")).toBe(false);
  expect(hasBombadilReviewContent("READY P\nNavigation sample 65: café 界 🙂.")).toBe(true);
  expect(hasBombadilReviewContent("READY D\n│+export const record12 = 13;")).toBe(true);
});
