# Releasing cueloop

Changesets drives every release. During the alpha phase the workspace is in
**pre mode** with tag `alpha`: versions look like `0.1.0-alpha.3` and publish
under the `alpha` dist-tag, so `npm i -g cueloop` installs nothing until the
first stable release while `npm i -g cueloop@alpha` gets the current build.

All packages version **in lockstep** (one fixed group), so a bump to any of them
bumps them all. That keeps the alpha honest: the CLI, daemon, client, schema,
extension API, and adapters are developed as one unit.

## What guards a release

Two checks run in CI so release breakage cannot reach npm silently:

- `check:release` - the machinery itself: required scripts and devDependencies,
  the test script covering `./test`, the changeset config, and publish metadata
  on every publishable package.
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

## npm auth: bootstrap once, then trusted publishing

Trusted publishing (OIDC) needs no stored secret and attaches provenance to
every tarball, but npm can only configure a trusted publisher on a package that
already exists. So:

### 1. Bootstrap (one time)

- npmjs.com → Access Tokens → **Granular Access Token**
  - name: `github-actions-cueloop-release`
  - **Bypass two-factor authentication: on** (CI cannot answer an OTP prompt)
  - Allowed IP ranges: **empty** (runner IPs rotate)
  - Packages and scopes: **Read and write** covering `@cueloop` and the
    unscoped `cueloop` package
  - Expiration: short - **7 days** is enough to bootstrap
- GitHub → repo Settings → Secrets and variables → Actions → new secret
  **`NPM_TOKEN`**
- Publish the first alpha through the normal flow above.

### 2. Cut over to trusted publishing (immediately after)

For each published package (`cueloop`, `@cueloop/schema`, `@cueloop/daemon`,
`@cueloop/client`, `@cueloop/extension-api`, `@cueloop/adapters`):

- npmjs.com → the package → Settings → **Publishing access** → Trusted publisher
  - Repository: `mmurakaru/cueloop`
  - Workflow: `release.yml`
  - Select the allowed action(s) - required for configurations created after
    2026-05-20.

Then **revoke the npm token** and **delete the `NPM_TOKEN` repo secret**. No
workflow change is needed: `id-token: write`, npm >= 11.5.1, and Node >= 22.14
are already configured, and npm falls back to OIDC when no token is present.

Verify the cutover on the next release: the run should publish with a
`provenance` attestation and no `NODE_AUTH_TOKEN` in the environment.
