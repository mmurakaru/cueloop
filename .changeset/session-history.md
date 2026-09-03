---
"@cueloop/schema": minor
"@cueloop/daemon": minor
"cueloop": minor
---

A review session's history is a tree of entries.

- Every write records an entry: the root revision, each new comment and each removal, each verdict, each merged collaborator comment, and each agent revision on `main`.
- Branches are named tips, checkpoints are labelled entries, and the artifact text and open comments derive from the active path; navigating and forking are pure operations on the history, ready for their primitives.
- Records written before histories existed migrate to a one-branch tree on read; a record with no revision keeps reading without one.
- Session storage sits behind one contract with a conformance suite run against the file store and an in-memory adapter.
