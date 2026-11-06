# @cueloop/gateway

The sharing gateway: one raw `ssh2` front door that renders a shared plan over
SSH and receives uploads. Private (never published); it runs on the VM behind
`cueloop.dev`.

One SSH session handler branches on channel type - the wish / gliderlabs /
git-shell model:

- **shell + PTY**, username `p_<id>` - load the blob for that id, decrypt, and
  render cueloop's real `<App>` read-only over the channel.
- **exec**, username `share` - read the uploaded blob stream, mint an id, seal
  it, store it, and answer `ssh p_<id>@cueloop.dev`.

The gateway is the only component that holds a key: clients upload plaintext
over SSH, the gateway seals it before R2 ever sees it (AES-256-GCM, per-blob key
via HKDF from one master key), and decrypts only to render server-side. See
`notes/Projects/cueloop/adr/0004-*` for the decisions.

## Configuration (environment)

| Variable                                                                    | Purpose                                          | Default                   |
| --------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------- |
| `CUELOOP_STORE`                                                             | `memory` for a throwaway local run; otherwise R2 | R2                        |
| `CUELOOP_MASTER_KEY_PATH`                                                   | 32-byte master key (0600, VM-only)               | `/etc/cueloop/master.key` |
| `CUELOOP_HOST_KEY_PATH`                                                     | persisted SSH host key                           | `/etc/cueloop/host_key`   |
| `CUELOOP_GATEWAY_PORT`                                                      | listen port                                      | `22`                      |
| `CUELOOP_GATEWAY_HOST`                                                      | bind address                                     | `0.0.0.0`                 |
| `CUELOOP_PUBLIC_HOST`                                                       | host printed in the ssh line                     | `cueloop.dev`             |
| `CUELOOP_R2_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_BUCKET` | R2 credentials                                   | bucket `cueloop-shares`   |

## Manual verification (fully local, no R2, no VM)

Runs the exact end-user path: create a plan, start the gateway with an in-memory
store, `cueloop share` it over system ssh, then view it back over ssh.

```sh
export CUELOOP_HOME="$(mktemp -d)" CUELOOP_IDLE_EXIT_MS=0
PORT=2200

# 1. a plan to share
SID=$(printf '# Rollout Plan\n\nShip the store move behind a flag.\n' \
  | bun packages/cli/src/main.ts session create --type plan --title "Rollout Plan" \
  | grep '"id"' | head -1 | sed -E 's/.*"id": *"([^"]+)".*/\1/')

# 2. the gateway (memory store, ephemeral key)
CUELOOP_STORE=memory CUELOOP_GATEWAY_PORT=$PORT CUELOOP_GATEWAY_HOST=127.0.0.1 \
  CUELOOP_HOST_KEY_PATH="$CUELOOP_HOME/gwhost" \
  bun packages/gateway/src/main.ts &

# 3. share it (prints + copies `ssh p_xxxxxxxx@cueloop.dev`)
ssh-keygen -R "[127.0.0.1]:$PORT" 2>/dev/null   # clear any stale local host key
bun packages/cli/src/main.ts share "$SID" --host 127.0.0.1 --port $PORT

# 4. view it - paste the id from step 3
ssh -p $PORT -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null p_xxxxxxxx@127.0.0.1
```

The plan renders with its annotations, `observer - read-only` chrome, and `q`
disconnects. The gateway's `p_<id>` uses an ephemeral key here, so ids do not
survive a restart in memory mode - that is expected for the local demo.

Automated coverage of the same loop is in `src/server.e2e.test.ts`.

## Resource limits

The gateway rejects excess TCP connections before parsing SSH, and counts connections
that have not sent an identification string. Authentication has an absolute deadline.
Established reviews and owner streams have no session expiry; SSH keepalives remove
unresponsive peers. Session channels are bounded per connection, including channels
that have not requested a shell or command. Viewer capacity includes storage reads
and collaborator authentication before rendering begins.

| Environment variable                  | Default | Bound                                          |
| ------------------------------------- | ------- | ---------------------------------------------- |
| `CUELOOP_MAX_CONNECTIONS`             | `128`   | concurrent TCP connections                     |
| `CUELOOP_MAX_CONNECTIONS_PER_IP`      | `16`    | concurrent TCP connections per source IP       |
| `CUELOOP_MAX_CHANNELS_PER_CONNECTION` | `8`     | concurrent SSH session channels per connection |
| `CUELOOP_MAX_VIEWERS`                 | `32`    | concurrent viewers, including pending opens    |
| `CUELOOP_AUTH_TIMEOUT_MS`             | `15000` | time from TCP accept to authenticated SSH      |
| `CUELOOP_UPLOAD_TIMEOUT_MS`           | `30000` | total time to receive a bounded request body   |

All overrides must be positive integers. Terminal dimensions are capped at 300 columns
and 100 rows, including resize requests. Uploads remain capped at 1 MiB. The upload
rate limiter tracks at most 10,000 source IPs and refuses new sources when full. It
reclaims entries idle for at least 60 seconds on subsequent requests, after enough
time for their tokens to refill completely.

Source IP means the TCP peer. Behind a proxy, configure limits for that topology:
this gateway does not parse PROXY protocol headers or trust forwarded IP claims.
Per-source limits can group users behind NAT or a proxy; the global limits still apply.
These limits bound process work and do not replace upstream network DDoS protection.

The raw TCP ingress uses ssh2's socket injection API. A one-line dependency patch
registers ssh2's TCP listener explicitly because Bun 1.3.14 does not dispatch
constructor-supplied listeners for manually emitted connection events. Keep that
patch when installing the gateway from source; the Docker mirror includes it.
