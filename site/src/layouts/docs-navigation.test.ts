import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

test("animates the docs sidebar only after a user toggle", () => {
  const layout = readFileSync(`${sourceRoot}/layouts/DocsLayout.astro`, "utf8");
  const styles = readFileSync(`${sourceRoot}/styles/global.css`, "utf8");

  expect(layout).toContain('shell.classList.add("is-nav-interacting")');
  expect(styles).toContain(
    ".docs-shell.is-nav-interacting:not(.is-nav-collapsed) .docs-aside",
  );
  expect(styles).not.toContain(".docs-shell:not(.is-nav-collapsed) .docs-aside");
});
