---
"cueloop": patch
---

Run the install-vm controller container privileged. Building the guest rootfs (unsquashfs, chroot, mkfs) and booting Firecracker (the kvm and tun devices, tap networking) need capabilities a dropped set cannot cover, so the earlier restricted set failed to even extract the Firecracker binary. No user-visible behavior changes.
