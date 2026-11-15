// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import { satteri } from "@astrojs/markdown-satteri";

// Static output for Cloudflare Pages on www.cueloop.dev. React is used only as
// islands for the interactive chrome (collapsible docs sidebar, copy-command,
// theme toggle) via React Aria; everything else is static Astro. See
// site/README.md for the deploy plan.
export default defineConfig({
  site: "https://www.cueloop.dev",
  integrations: [react(), mdx()],
  // Keep the previous HTML-aware compression so a single space between inline
  // elements is preserved. The Astro 7 default ("jsx") strips that whitespace
  // and can join words.
  compressHTML: true,
  markdown: {
    // Keep punctuation literal: no `--` to en-dash or `---` to em-dash conversion.
    processor: satteri({
      features: { smartPunctuation: false },
    }),
    // Light and dark syntax themes; defaultColor: false emits both as CSS vars
    // so global.css can switch on [data-theme].
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    },
  },
});
