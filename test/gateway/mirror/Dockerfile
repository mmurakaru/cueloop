FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libcap2-bin && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN setcap cap_net_bind_service=+ep /usr/local/bin/bun && mkdir -p /home/ubuntu/cueloop /state && chown -R ubuntu:ubuntu /home/ubuntu /state
WORKDIR /home/ubuntu/cueloop
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY hooks ./hooks
COPY tools ./tools
COPY test/gateway/mirror/gateway-entry.sh /usr/local/bin/gateway-entry
RUN bun install --frozen-lockfile && chmod 755 /usr/local/bin/gateway-entry
USER ubuntu
ENTRYPOINT ["/usr/local/bin/gateway-entry"]
