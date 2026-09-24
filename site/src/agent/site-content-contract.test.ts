import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { docsNav } from "../nav";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

function readSiteFile(path: string): string {
  return readFileSync(`${sourceRoot}/${path}`, "utf8");
}

test("keeps the landing page hero headline stable", () => {
  expect(readSiteFile("pages/index.astro")).toContain(
    'plan, diff <span class="amp">&amp;</span> review.',
  );
});

test("uses Comments as the public docs term", () => {
  const navigation = docsNav.flatMap((group) => group.items);

  expect(navigation).toContainEqual({ title: "Comments", href: "/docs/concepts/comments/" });
  expect(navigation.some((item) => item.title === "Annotations")).toBeFalse();
  expect(readSiteFile("pages/docs/concepts/comments.mdx")).toContain("A comment is feedback");
});

test("keeps Cloudflare email protection out of the SSH copy surface", () => {
  const escape = readSiteFile("components/EmailObfuscationEscape.astro");
  const sharing = readSiteFile("pages/docs/sharing/index.mdx");

  expect(escape).toBe("<!--email_off--><slot /><!--/email_off-->\n");
  expect(sharing).toContain("<EmailObfuscationEscape>");
  expect(sharing).toContain("ssh p_7f3k9x2q@cueloop.dev");
});

test("publishes agent discovery and instruction files", () => {
  const llms = readSiteFile("../public/llms.txt");
  const robots = readSiteFile("../public/robots.txt");
  const routes = readSiteFile("../public/_routes.json");
  const skill = readSiteFile("../public/SKILL.md");

  expect(llms).toContain("## When to use cueloop");
  expect(llms).toContain("https://www.cueloop.dev/openapi.json");
  expect(robots).toContain("Sitemap: https://www.cueloop.dev/sitemap.xml");
  expect(routes).toContain('"/_astro/*"');
  expect(routes).toContain('"/icons/*"');
  expect(routes).not.toContain('"/api/*"');
  expect(skill).toContain("name: cueloop");
});

test("provides substantive trust pages", () => {
  for (const page of ["pages/about.astro", "pages/contact.astro", "pages/privacy.astro"]) {
    expect(readSiteFile(page).length).toBeGreaterThan(500);
  }
});
