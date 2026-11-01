import { expect, test } from "bun:test";
import { LineBuffer } from "./protocol";

test("partial and coalesced frames keep order and leave the last frame pending", () => {
  const buffer = new LineBuffer();
  const lines: string[] = [];

  for (const chunk of [' {"a":', '1}\n\n {"b":2}\n{"c":', "3}", "\n"])
    buffer.push(chunk, (line) => lines.push(line));

  expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("large fragmented frames preserve text and allow a following frame", () => {
  const buffer = new LineBuffer();
  const text = JSON.stringify({ text: "漢字 🌍 ".repeat(150_000) });
  const lines: string[] = [];

  for (let offset = 0; offset < text.length; offset += 4096)
    buffer.push(text.slice(offset, offset + 4096), (line) => lines.push(line));

  expect(lines).toEqual([]);
  buffer.push('\n{"done":true}\n', (line) => lines.push(line));
  expect(lines).toEqual([text, '{"done":true}']);
});

test("a callback can supply more frames without changing pending frame order", () => {
  const buffer = new LineBuffer();
  const lines: string[] = [];

  buffer.push("first\nsecond\n", (line) => {
    lines.push(line);
    buffer.push("third\n", (next) => lines.push(next));
  });

  expect(lines).toEqual(["first", "second", "third"]);
});
