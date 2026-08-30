---
"cueloop": patch
---

Read tarball contents from the archive itself during the publish check, instead of trusting `npm pack --json` whose output shape differs between npm majors.
