---
"cueloop": minor
---

Add the `reply` primitive: `cueloop reply` opens the latest pending reply review (or one by id/title), and the `/cueloop:reply` skill submits the agent's previous message for line-level human review. A reply is a first-class markdown artifact type, so it renders through the plan sheet, derives its title from the first heading, and gets revision drift-assist - the plan-like behaviors now key on the shared `isMarkdownArtifact` predicate in `@cueloop/schema` rather than a `type === "plan"` literal. Content flows through the existing skill path (the agent writes its reply to a file and submits `--type reply`), so there is no transcript reader and no new daemon plumbing. The verdict rides the same non-blocking wake as plan reviews.
