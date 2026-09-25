import { expect, test } from "bun:test";
import { renderCueloopSitemap } from "../pages/sitemap.xml";

test("lists canonical docs and trust pages with lastmod dates", () => {
  const sitemap = renderCueloopSitemap("2026-09-23T00:00:00.000Z");

  expect(sitemap).toContain("https://www.cueloop.dev/docs/concepts/comments/");
  expect(sitemap).toContain("https://www.cueloop.dev/docs/reference/api/");
  expect(sitemap).toContain("https://www.cueloop.dev/about/");
  expect(sitemap).toContain("<lastmod>2026-09-23T00:00:00.000Z</lastmod>");
  expect(sitemap).not.toContain("annotations");
});
