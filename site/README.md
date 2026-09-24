# cueloop site

The Astro site for [cueloop.dev](https://www.cueloop.dev). It contains the
product page, documentation, public discovery API, and agent-readable files.

The site has its own dependencies and is not part of the root Bun workspace.

## Develop

```bash
cd site
bun install
bun run dev
```

## Verify

```bash
bun run test
bun run check
bun run build
```

The build writes the static site and Markdown page variants to `site/dist`.
Cloudflare Pages Functions add content negotiation and the read-only public API.

## Deploy

The `Deploy site` GitHub Actions workflow deploys `main` to
`www.cueloop.dev`. Add the `deploy-preview` label to a pull request to create a
preview deployment.
