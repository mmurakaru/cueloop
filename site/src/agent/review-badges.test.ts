import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const publicRoot = fileURLToPath(new URL("../../public", import.meta.url));

test("serves labeled review badges in the agreed severity colors", () => {
  const badges = {
    p0: "#d96c6c",
    p1: "#e3c66f",
    p2: "#86c98a",
  } as const;

  for (const [severity, background] of Object.entries(badges)) {
    const svg = readFileSync(`${publicRoot}/badges/${severity}.svg`, "utf8");

    expect(svg).toContain('width="20" height="20"');
    expect(svg).toContain(`fill="${background}"`);
    expect(svg).toContain('<path fill="#2a2a2a"');
  }
});
