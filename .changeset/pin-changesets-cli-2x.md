---
---

Release-tooling only: pin `@changesets/cli` to `^2.31.0`. The 3.x major rewrites pre-mode storage - moving accumulated changesets into a `.changeset/pre/` subdirectory and stripping `initialVersions` + the tracked changesets from `pre.json` - which made `changeset version` fail with `ENOENT .changeset/pre/changes.md` and every Release PR corrupt. Also ignore `@changesets/cli` majors in Dependabot until the pre-state is migrated. No shipped package behavior changes.
