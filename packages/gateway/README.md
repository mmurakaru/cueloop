# @cueloop/gateway

Receive shared artifacts over SSH and render them in cueloop.
This private package runs the gateway behind `cueloop.dev`.

- Upload through an SSH exec channel as `share`.
- Open the returned SSH command to view the artifact.
- Shared agent requests wait for the owner's connected daemon.

> [!IMPORTANT]
> The gateway can decrypt shared artifacts.
> SSH protects uploads in transit; the gateway encrypts them before R2 storage with AES-256-GCM and per-blob keys derived from its master key.

## Configure

| Variable                       | Purpose                         | Default                   |
| ------------------------------ | ------------------------------- | ------------------------- |
| `CUELOOP_STORE`                | `memory` or R2 storage          | R2                        |
| `CUELOOP_MASTER_KEY_PATH`      | 32-byte master key, mode `0600` | `/etc/cueloop/master.key` |
| `CUELOOP_HOST_KEY_PATH`        | Persistent SSH host key         | `/etc/cueloop/host_key`   |
| `CUELOOP_GATEWAY_PORT`         | SSH port                        | `22`                      |
| `CUELOOP_GATEWAY_HOST`         | Bind address                    | `0.0.0.0`                 |
| `CUELOOP_PUBLIC_HOST`          | Host in returned SSH commands   | `cueloop.dev`             |
| `CUELOOP_R2_ENDPOINT`          | R2 endpoint                     | Required for R2           |
| `CUELOOP_R2_ACCESS_KEY_ID`     | R2 access key                   | Required for R2           |
| `CUELOOP_R2_SECRET_ACCESS_KEY` | R2 secret                       | Required for R2           |
| `CUELOOP_R2_BUCKET`            | Share bucket                    | `cueloop-shares`          |
| `CUELOOP_METRICS_PORT`         | Metrics listener                | Disabled                  |
| `CUELOOP_METRICS_HOST`         | Metrics bind address            | `127.0.0.1`               |

Supply credentials through the environment.

## Try locally

From the repository root, start a temporary gateway:

```sh
export CUELOOP_HOME="$(mktemp -d)"
export CUELOOP_IDLE_EXIT_MS=0
export CUELOOP_STORE=memory
export CUELOOP_GATEWAY_HOST=127.0.0.1
export CUELOOP_GATEWAY_PORT=2200
export CUELOOP_HOST_KEY_PATH="$CUELOOP_HOME/gateway-host-key"
bun run packages/gateway/src/main.ts
```

In another terminal, create a plan and copy its returned identifier:

```sh
printf '# Rollout plan\n\nShip the store move behind a flag.\n' \
  | bun run packages/cli/src/main.ts session create --type plan --title "Rollout plan"
```

Share it using the same `CUELOOP_HOME`.
Remove the old local demo host key before using the temporary gateway:

```sh
ssh-keygen -R "[127.0.0.1]:2200"
bun run packages/cli/src/main.ts share THREAD_IDENTIFIER --host 127.0.0.1 --port 2200
ssh -p 2200 SHARE_IDENTIFIER@127.0.0.1
```

Replace `THREAD_IDENTIFIER` with the local Thread identifier and `SHARE_IDENTIFIER` with the username in the returned SSH command.
Press `q` to disconnect.

> [!NOTE]
> Memory mode uses an ephemeral encryption key.
> Shares disappear when the gateway stops.
> Keep the same temporary home in both terminals.

The automated SSH round trip is in [server.e2e.test.ts](src/server.e2e.test.ts).
