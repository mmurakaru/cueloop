---
"cueloop": patch
---

Run the clean-machine install tests on x64 only and pass a scenario filter only when the dispatch names one. GitHub's free hosted arm64 Linux runners do not expose /dev/kvm, so a guest cannot boot there; an empty scenario input no longer breaks argument parsing. No user-visible behavior changes.
