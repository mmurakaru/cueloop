# The install-vm controller image: everything needed to fetch and build the
# base rootfs, run Firecracker, and drive the guests over SSH. Pinned to the
# Ubuntu 24.04 tag. Docker layer caching rebuilds it only when this file or the
# copied scripts change.
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      e2fsprogs \
      iproute2 \
      iptables \
      jq \
      openssh-client \
      python3 \
      squashfs-tools \
      tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY controller.sh /work/controller.sh
COPY prepare-base-image.sh /work/prepare-base-image.sh
RUN chmod +x /work/controller.sh /work/prepare-base-image.sh

ENTRYPOINT ["/work/controller.sh"]
