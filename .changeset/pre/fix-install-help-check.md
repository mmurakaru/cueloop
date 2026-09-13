---
---

Fix the install gate's `--help` check: it asserted the first line was "Usage: cueloop", but `cueloop --help` opens with its tagline and prints a lowercase "usage: cueloop" line. The check now matches the real help. CI-only; no package change.
