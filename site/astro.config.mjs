// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

// Static output. The site is intended for Cloudflare Pages on www.cueloop.dev.
// See site/README.md for the deploy plan. No deploy runs from this config.
export default defineConfig({
  site: "https://www.cueloop.dev",
  integrations: [mdx()],
});
