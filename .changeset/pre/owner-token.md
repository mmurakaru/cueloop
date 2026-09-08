---
"@cueloop/daemon": minor
"cueloop": minor
---

Ownership of the daemon is proven, never declared.

- Every connection starts as a collaborator; the daemon mints an owner token into its home on each run (mode 0600) and the local client presents it on connect.
- A request to be the owner without the token is refused, so a review-side agent stays capped to reading, waiting, and commenting whatever it sends.
- The roles of every primitive live in one table that must name each primitive the daemon accepts.
