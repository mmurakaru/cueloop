import type { APIRoute } from "astro";
import { docsNav } from "../nav";

export const prerender = true;

const siteOrigin = "https://www.cueloop.dev";
const staticRoutes = ["/", "/about/", "/contact/", "/privacy/"];
const routes = [
  ...staticRoutes,
  ...docsNav.flatMap((group) => group.items.map((item) => item.href)),
];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Renders the canonical public routes as an XML sitemap. */
export function renderCueloopSitemap(lastModified: string): string {
  const entries = [...new Set(routes)]
    .map(
      (route) =>
        `  <url><loc>${escapeXml(new URL(route, siteOrigin).href)}</loc><lastmod>${lastModified}</lastmod></url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export const GET: APIRoute = () =>
  new Response(renderCueloopSitemap(new Date().toISOString()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
