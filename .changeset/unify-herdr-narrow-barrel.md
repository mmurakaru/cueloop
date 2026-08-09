---
"cueloop": patch
---

Single-source the herdr env contract in @cueloop/schema (detectHerdr, insideHerdr, returnPaneFor) so the reviewer-side return-focus and the agent-side state reporting can no longer drift on which variables are required; the two IO helpers (focusHerdrPane, reportState/reportLabel) stay with their sole consumers. Narrow the @cueloop/daemon barrel to the two names imported bare (DaemonServer, cueloopHome); the client and review helpers keep coming through the ./client and ./review subpaths. No behavior change.
