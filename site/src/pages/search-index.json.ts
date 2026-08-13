/*
 * Static search index endpoint. Built once at build time from the docs
 * frontmatter (see search-data.ts) and fetched by the client-side search
 * palette, so the MDX modules never end up in the search bundle.
 */
import type { APIRoute } from "astro";
import { searchDocs } from "../search-data";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(searchDocs), {
    headers: { "content-type": "application/json" },
  });
