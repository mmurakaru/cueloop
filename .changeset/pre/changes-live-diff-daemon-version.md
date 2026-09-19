---
"cueloop": patch
---

The Changes navigator opens every changed file as a real diff, for any thread - not just a diff review. A non-diff thread (a plan, or the no-session welcome) computes the live working-tree diff against HEAD on demand; a diff review keeps showing its captured snapshot. The read-only file-contents view in the Project panel now syntax-highlights with the language detected from the file path.

Upgrades no longer strand a stale daemon: the client and daemon exchange build versions on connect, and a newer client automatically replaces a daemon left running from an earlier build instead of talking to old code. In development, `bun run dev:watch` reloads the daemon on source edits.
