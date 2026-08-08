import { describe, expect, test } from "bun:test";
import { filetypeFor, highlightCode } from "./syntax";

const TS = `export function gate(full: number) {
  // threshold
  return full < 0.6 ? "blocked" : "clear";
}`;

describe("highlightCode", () => {
  test("token text concatenates back to the exact source (verbatim rendering)", async () => {
    const lines = await highlightCode(TS, "ts");
    expect(lines).not.toBeNull();
    const rebuilt = lines!.map((l) => l.map((t) => t.content).join("")).join("\n");
    expect(rebuilt).toBe(TS);
  });

  test("keywords, strings, and comments get distinct colors", async () => {
    const lines = await highlightCode(TS, "ts");
    const colorOf = (needle: string) => {
      for (const line of lines!) for (const t of line) if (t.content.includes(needle)) return t.color;
      return undefined;
    };
    const kw = colorOf("export");
    const str = colorOf("blocked");
    const comment = colorOf("threshold");
    expect(kw).toBeDefined();
    expect(str).toBeDefined();
    expect(comment).toBeDefined();
    expect(new Set([kw, str, comment]).size).toBe(3);
  });

  test("unknown languages return null and render unstyled", async () => {
    expect(await highlightCode("whatever", "brainfog")).toBeNull();
    expect(await highlightCode("plain", undefined)).toBeNull();
  });

  test("fence aliases map to real grammars", async () => {
    expect(await highlightCode("x = 1", "py")).not.toBeNull();
    expect(await highlightCode('echo "hi"', "sh")).not.toBeNull();
  });
});
