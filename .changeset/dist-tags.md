---
"cueloop": patch
---

Point the alpha dist-tag at the published release. Prereleases were landing on `latest` while `alpha` kept pointing at the first (broken) publish, so `npm i cueloop@alpha` served the wrong build; the release lane now retags every package and the verification step checks the tag a stranger would install, not just the exact version.
