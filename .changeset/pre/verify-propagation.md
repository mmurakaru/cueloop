---
"cueloop": patch
---

Document the npm install path (`npm i -g cueloop@alpha`) and stop the release verifier from failing on registry propagation lag: registry assertions now poll until they hold, so a CDN serving a stale document moments after a publish no longer looks like a broken release.
