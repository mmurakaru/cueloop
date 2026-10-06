# Local gateway mirror

Run from the repository root after `bun install`:

```sh
bun run test:gateway-mirror
```

Docker Engine with Compose, Bun, and `ssh` must be available. Apple Silicon uses
Docker's amd64 emulation. The native Ghostty screen reader is already included
for macOS arm64. On Linux, build it first:

```sh
sh packages/client/native/build.sh
bun run test:gateway-mirror
```

The runner builds the current working tree, including uncommitted changes. It
starts a unique Compose project with a Ubuntu 24.04 amd64 gateway, Bun 1.3.14,
one CPU and 1 GiB of memory. The gateway runs as the non-root `ubuntu` user on
port 22 inside the container. Ports bind only to localhost, with unused host
ports assigned automatically. SeaweedFS supplies persistent S3 storage to the
same `R2ShareStore` implementation used by the deployed gateway. Images are
pinned by digest.

An isolated owner daemon runs the actual Pi durable adapter. Two independently
authenticated collaborators interact with the actual gateway TUI over SSH.
Assertions read the rendered screen through the Ghostty VT emulator. Only the
model provider is scripted, so the suite needs no model subscription and incurs
no model charges. It tests transport and conversation persistence, not provider
login or live model behavior.

The checks cover:

- The Linux architecture, OS, Bun version, non-root execution, SSH listener and
  private persistent key files.
- Inline comments saved with Option+Enter without starting the agent.
- Ctrl+Enter prompts, Unicode streaming and replies broadcast to collaborators.
- Rejection of an execution-channel connection from another SSH identity.
- Ciphertext in S3 rather than readable agent history.
- Visible owner disconnection and durable acceptance of offline input.
- Replacement of gateway and storage containers without losing keys or input.
- Owner daemon restart with preserved Pi context and one execution of queued input.
- Reconnection without another model execution.
- Disabled shared agents retaining ordinary comments and rejecting agent access.

Each run writes a JSON report and container logs to a new
`cueloop-gateway-report-*` directory under the operating system's temporary
directory. It then removes its own containers, network, volumes, SSH keys and
owner state, including on failure. Other Docker projects are untouched. The
`Local gateway mirror` CI job runs the same command on Ubuntu.

Run this suite before pushing changes that affect sharing, the gateway, shared
agent execution or its UI. A failing local run blocks deployment readiness.

## What this proves

This is an application mirror of the current gateway host profile. It exercises
real Linux native libraries, SSH, S3 requests, encrypted blobs and owner recovery.
Containers share Docker's Linux VM kernel. They do not reproduce the host's
systemd unit, 45 GiB boot disk, OCI security lists, IAM, public DNS, firewall or
Cloudflare R2 service guarantees. A small deployment smoke check is still needed
for those boundaries. Passing local tests cannot establish 100% production
confidence.

Oracle publishes [local Vagrant boxes](https://yum.oracle.com/boxes/), but
[VirtualBox on Apple Silicon requires ARM guests](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/Introduction.html).
That does not match this gateway's x86 host. A full guest-kernel/systemd test
would require a fresh x86 Ubuntu VM under QEMU emulation. Do not export the live
production image or mount production credentials into this fixture.
