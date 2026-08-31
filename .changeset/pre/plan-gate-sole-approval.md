---
"cueloop": patch
---

The plan-mode gate is now the sole approval - no more double dialog. The `ExitPlanMode` hook was emitting a bare top-level `decision`, a shape Claude Code no longer recognizes, so it fell through to the native plan-approval dialog and you approved twice (once in cc's "approve / auto-accept" prompt, once in cueloop). The hook now returns the documented `hookSpecificOutput` PermissionRequest shape, which suppresses the native dialog: cueloop is the only place a plan is approved. To use vanilla plan mode, disable the plugin (`/plugin`, or `enabledPlugins: { "cueloop@cueloop": false }`).
