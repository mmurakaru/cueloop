# cueloop site

The marketing and docs site for cueloop. A small static [Astro](https://astro.build) site
that explains the concepts, living in the repo so the docs evolve with the code.

This site is **not** part of the published `cueloop` npm package. It is a standalone folder
with its own `package.json` and its own install. It is deliberately kept out of the Bun
workspace at the repo root, so the root `bun install --frozen-lockfile`, `typecheck`, and
`test` runs never touch it.

## Layout

```
site/
  astro.config.mjs      static build, MDX integration, site = www.cueloop.dev
  tsconfig.json         extends astro/tsconfigs/strict (self-contained)
  wrangler.toml         Cloudflare Pages config stub - NOT yet deployed
  src/
    concepts.ts         the concept pages, in reading order (one source of truth)
    layouts/            BaseLayout (shell) and DocLayout (concept pages)
    components/         Placeholder (a marked slot for future art)
    styles/global.css   one small terminal-native stylesheet
    pages/
      index.astro       landing page: one-line what/why plus the core loop
      install.mdx       install and quickstart
      concepts/
        review-session.mdx      the core primitive
        annotations.mdx         quote-anchored, stable ids
        plan-diff-review.mdx    the three verbs
        sharing-over-ssh.mdx    the design direction (terminal only)
  public/               static assets (favicon)
```

## Develop

From this folder:

```bash
bun install     # installs the site's own dependencies
bun run dev      # local dev server
bun run build    # static build to ./dist
bun run preview  # serve the built site
```

The build writes static HTML to `site/dist`.

## Deploy (deferred - not yet live)

The site is intended for [Cloudflare Pages](https://developers.cloudflare.com/pages/) on
`www.cueloop.dev` (orange-cloud, proxied). The apex `cueloop.dev` is reserved grey-cloud for
the future SSH gateway (see the "Sharing over SSH" concept page), so the two never collide.

`wrangler.toml` in this folder is a **stub**, present so the Pages build settings are
discoverable and version-controlled. It is not yet wired to a Cloudflare account, and no
deploy has run. When the account exists, the intended Pages build settings are:

- **Build command:** `bun run build` (or `npm run build`)
- **Build output directory:** `dist`
- **Root directory:** `site`

Do not run a deploy from this repository until the Cloudflare account and the `www.cueloop.dev`
hostname are set up.
