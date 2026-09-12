# Install matrix

Verifies every published install path on a spread of machines. The test logic
lives in one place: the scenario scripts. Two runners drive them, and one
`bun test` file locks the whole harness in.

## Scenarios

Each scenario is a pure POSIX `sh` script under `scenarios/` that installs the
product one way and appends tab-separated assertions to `$MATRIX_ASSERTIONS`
through the helpers in `lib.sh`. Being pure POSIX, a scenario runs unchanged on
a bare distribution with no Node and no Bun.

| Scenario       | What it proves                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `curl-clean`   | the curl installer works on a machine with no Node or Bun on PATH: it installs, verifies its checksum, runs, and puts itself on PATH |
| `curl-rerun`   | a second install of the same version reports "already installed" and downloads nothing                                               |
| `curl-upgrade` | the previous version is replaced by the target version, with no partial file left behind                                             |
| `npm`          | `npm install -g cueloop@<version>` installs the published CLI and it runs                                                            |
| `brew`         | the Homebrew formula installs and passes its own test block                                                                          |
| `plugin`       | the Claude Code plugin manifest is valid and version-matched to the CLI                                                              |

Each scenario declares the evidence it must record with `expect` at the top. A
finalizer in `lib.sh` turns any declared-but-unrecorded id into a failure on
exit, so a scenario that skips an assertion or aborts mid-way fails loudly.
Because the contract lives in the shared layer, both runners enforce it.
`scenarios.json` only names the scenarios and their one-line descriptions.

## Runners

- `run.ts` is the richer host. With `--assets <dir>` it serves an offline
  release from a `<dir>/<tag>/<asset>` tree, points the installer at it through
  the CUELOOP\_\* overrides, checks the required evidence, and writes
  `result.json` and a JUnit report. The release workflow uses it to gate the
  freshly staged binaries before publish.
- `run.sh` is the bare-distro runner. It needs no toolchain, so it runs the
  scenarios in a minimal container. The weekly workflow uses it against the
  real published release.

## Running locally

```sh
# the whole harness, served offline, no network:
bun test ./test/install/matrix.test.ts

# one scenario against the real published release:
CUELOOP_VERSION=0.1.0-alpha.70 sh test/install/matrix/run.sh curl-clean
```
