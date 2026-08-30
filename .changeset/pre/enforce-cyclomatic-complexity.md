---
"cueloop": patch
"@cueloop/client": patch
"@cueloop/daemon": patch
---

Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.
