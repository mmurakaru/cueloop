#!/bin/sh
set -eu
umask 077
if [ ! -f /state/master.key ]; then
  head -c 32 /dev/urandom > /state/master.key
fi
exec bun run packages/gateway/src/main.ts
