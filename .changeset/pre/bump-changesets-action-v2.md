---
---

Release-flow only: upgrade `changesets/action` from v1 to v2. v1 cannot read changesets v3's `.changeset/pre/` prerelease layout and fails the Version PR job with `ENOENT .changeset/pre/changes.md`; v2 supports it. Input names updated accordingly (`version-script`, `pr-title`, `commit-message`, `github-token`). No shipped package behavior changes.
