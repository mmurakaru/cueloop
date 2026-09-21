#!/bin/sh
# Claude runs this fallback only when the required Mod cannot load.
printf '%s\n' '{"decision":"block","reason":"cueloop requires the Claude Mod. Use Claude Code 2.1.278 or newer with function hooks enabled, and restart the session. No tool call was run."}'
