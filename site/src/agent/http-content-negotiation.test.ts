import { describe, expect, test } from "bun:test";
import { negotiateDocumentContent } from "./http-content-negotiation";

describe("negotiateDocumentContent", () => {
  test.each([
    [null, "html"],
    ["*/*", "html"],
    ["text/html", "html"],
    ["text/markdown", "markdown"],
    ["text/markdown, text/html;q=0.8", "markdown"],
    ["text/html;q=0.9, text/markdown;q=0.4", "html"],
    ["text/markdown;q=0, text/html;q=0.8", "html"],
    ["text/html;q=0, */*;q=0.8", "markdown"],
    ["application/json", "not-acceptable"],
  ] as const)("maps %s to %s", (accept, expected) => {
    expect(negotiateDocumentContent(accept)).toBe(expected);
  });

  test("uses the request order when equally preferred types tie", () => {
    expect(negotiateDocumentContent("text/markdown, text/html")).toBe("markdown");
  });
});
