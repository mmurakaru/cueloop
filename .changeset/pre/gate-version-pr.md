---
---

Release-flow only: run the version-pr `changeset version` step only when a new changeset is queued at the top level. Under changesets v3 the versioned prerelease changesets live in `.changeset/pre/`, and `changeset version` errors there when nothing new is pending - so a release run with no queued changeset failed the Version PR job. Gate it on the pending count. No shipped package behavior changes.
