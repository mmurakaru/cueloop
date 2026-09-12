# Install VM

Clean-machine install tests: the real installer inside a fresh Firecracker
microVM, one per scenario. A microVM is a truly clean box, unlike a hosted
runner or a container that ships node, bun, git, and a shared kernel. That
catches installer bugs that only show on a fresh machine: a missing shared
library, an empty PATH, an unset HOME, a daemon left running, or no network.

Covers Linux x64 and arm64. macOS clean-machine coverage stays on the hosted
`macos-*` runners in the [install matrix](../matrix/README.md).

## Why not on pull requests

The job needs `sudo` on the runner to open `/dev/kvm` and it boots a VM, so it
must never run untrusted fork code. `install-vm.yml` runs nightly, on demand via
`workflow_dispatch`, and on pushes to `main` that touch the installer or this
harness. It is never triggered by `pull_request` or `pull_request_target`.

## Pieces

- `pins.json` pins the Firecracker binary, guest kernel, and base rootfs per
  arch, each with a sha256. Every artifact is verified before use.
- `prepare-base-image.sh` downloads and verifies those, configures networking
  and SSH, adds zsh and fish, and builds a base ext4 image.
- `Dockerfile` builds the controller image. `runner.ts` tags it by a hash of the
  harness inputs, so it rebuilds only when they change.
- `controller.sh` is PID 1 in that container. It serves the offline release,
  and per scenario reflink-clones the base disk, injects the SSH key, boots the
  VM, runs the scenario over SSH, and copies its assertions back.
- `runner.ts` is the host entry: preflight, fixture staging, image build,
  container run, and aggregation into `result.json` and a JUnit report. It
  reuses the install-matrix assertion format.
- `scenarios/*.sh` are the guest scenarios. They source the shared `lib.sh`
  contract from the install matrix, so a skipped assertion still fails.

## Pinning the artifacts

`pins.json` ships with empty sha256 fields. Fill them once, on a KVM-capable
Linux box, then commit the diff:

```sh
bun run test:install-vm -- --update-pins
```

`prepare-base-image.sh` refuses to run against unpinned artifacts, so a
scheduled run is red until the hashes are committed.

## Running locally

You need a Linux host with KVM (`/dev/kvm`), Docker, and about 6 GB free.

```sh
sudo chmod a+rw /dev/kvm
bun run test:install-vm                       # all scenarios
bun run test:install-vm -- --scenario clean-machine
```

Preflight is a hard failure: a missing `/dev/kvm`, tun device, Docker, or disk
space stops the run rather than passing with a warning.
