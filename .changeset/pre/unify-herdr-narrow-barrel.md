---
"cueloop": patch
---

Single-source the herdr env contract in @cueloop/schema (detectHerdr, insideHerdr, returnPaneFor) so the reviewer-side return-focus and the agent-side state reporting can no longer drift on which variables are required. focusHerdrPane now takes the herdr binary path as an argument, resolved once by the caller through detectHerdr, instead of re-reading HERDR_BIN_PATH with its own "herdr"-on-PATH fallback - so the reviewer side and the reporting side agree that the binary path is part of the contract. The two IO helpers stay with their sole consumers (focusHerdrPane in client, reportState/reportLabel in adapters). Narrow the @cueloop/daemon barrel to the two names imported bare (DaemonServer, cueloopHome); the client and review helpers keep coming through the ./client and ./review subpaths. No behavior change inside a herdr pane, where the binary path is always set.
