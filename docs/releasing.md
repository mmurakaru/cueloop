# Releasing cueloop

Changesets drives every release. During the alpha phase the workspace is in
**pre mode** with tag `alpha`: versions look like `0.1.0-alpha.3` and publish
under the `alpha` dist-tag, so `npm i -g cueloop` installs nothing until the
first stable release while `npm i -g cueloop@alpha` gets the current build.

All packages version **in lockstep** (one fixed group), so a bump to any of them
bumps them all. That keeps the alpha honest: the CLI, daemon, client, schema,
extension API, and adapters are developed as one unit.

## What a release produces

`npm i -g cueloop@alpha` installs the CLI; `@cueloop/*` packages publish
alongside it at the same version for extension and adapter authors.

## What guards a release

Two checks run in CI so release breakage cannot reach npm silently:

- `check:release` - the machinery itself: required scripts and devDependencies,
  the test script covering `./test`, the changeset config, and publish metadata
  on every publishable package.
- `verify:published` - runs after publishing: every package must be on the
  registry at the released version, the prerelease dist-tag must resolve to it,
  and the CLI must install from npm by tag and run. Registry reads poll (the CDN
  can serve a stale document for a minute after a publish or retag).
- `check:publish` - packs every package exactly as npm would and inspects the
  tarballs: no package-manager-only dependency protocol (`workspace:` and
  friends cannot be resolved by an npm client), and every manifest entry point
  is actually shipped. PRs run it in `--dev` mode (protocols are legitimate in
  the repo); the release lane runs it strictly, after the version step, as the
  last gate before `changeset publish`.

Internal dependency ranges are rewritten from `workspace:*` to the concrete
lockstep version during `bun run version`, so tarballs carry resolvable ranges
while local development still links workspace members.

## Every PR

Ship a changeset:

```bash
bunx changeset            # pick bump level, write one user-facing sentence
bunx changeset --empty    # docs/CI-only changes
```

CI blocks PRs without one. Never hand-edit `CHANGELOG.md` or a `version` field -
the Release PR does that.

## Cutting a release

1. Merge PRs to `main` as usual.
2. The release workflow opens (or updates) a **"Release: version packages"** PR
   that consumes the pending changesets: version bumps, changelog entries, and
   the `.claude-plugin/plugin.json` version sync.
3. Merge that PR. The workflow runs again and publishes to npm.
   - With `RELEASE_TOKEN` set, the merge triggers the publish automatically.
   - Without it, start the run manually: Actions → release → Run workflow.

## Leaving the alpha

```bash
bunx changeset pre exit   # then a normal release publishes 0.1.0 on `latest`
```

Commit the `.changeset/pre.json` removal with a changeset like any other change.

## npm auth: OIDC for publish, a scoped token for dist-tags

Auth is split by operation, because OIDC covers `npm publish` but NOT
`npm dist-tag add`:

### Publishing → trusted publishing (OIDC), no token

Needs no stored secret and attaches provenance to every tarball. npm can only
configure a trusted publisher on a package that already exists, so a package's
FIRST publish is done once with a token (see below), then per package:

- npmjs.com → the package → Settings → **Publishing access** → Trusted publisher
  - Repository: `mmurakaru/cueloop`, Workflow: `release.yml`
  - Select the allowed action(s) - required for configs created after 2026-05-20.

Packages: `cueloop`, `@cueloop/schema`, `@cueloop/daemon`, `@cueloop/client`,
`@cueloop/extension-api`, `@cueloop/adapters`, `@cueloop/integration-obsidian`.
The publish step carries no `NODE_AUTH_TOKEN`, so npm uses OIDC automatically.

### Dist-tags → a retained scoped `NPM_TOKEN`

In changesets pre mode, `changeset publish` lands on `latest`; the sync step then
points `alpha` at the new version with `npm dist-tag add`, which OIDC cannot
authenticate. So we keep one repo secret **`NPM_TOKEN`**, wired ONLY into the
`Sync prerelease dist-tags` step:

- npmjs.com → Access Tokens → **Granular Access Token**
  - name: `cueloop-ci-dist-tags`
  - Packages and scopes: **Read and write** covering `@cueloop` + the unscoped
    `cueloop` package (Organizations: No access)
  - Expiration: set one and rotate (npm requires it)
- GitHub → repo Settings → Secrets and variables → Actions → secret **`NPM_TOKEN`**

Do NOT delete this secret after cutover - publishing uses OIDC, but the dist-tag
step needs the token. Verify on the next release: the run publishes with a
`provenance` attestation and the `alpha` dist-tag resolves to the new version.
