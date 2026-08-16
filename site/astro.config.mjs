// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";

// Static output for Cloudflare Pages on www.cueloop.dev. React is used only as
// islands for the interactive chrome (collapsible docs sidebar, copy-command,
// theme toggle) via React Aria; everything else is static Astro. See
// site/README.md for the deploy plan.
export default defineConfig({
  site: "https://www.cueloop.dev",
  integrations: [react(), mdx()],
  markdown: {
    // Keep punctuation literal: no `--` -> en-dash or `---` -> em-dash conversion.
    smartypants: false,
    // Light and dark syntax themes; defaultColor: false emits both as CSS vars
    // so global.css can switch on [data-theme].
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    },
  },
});
