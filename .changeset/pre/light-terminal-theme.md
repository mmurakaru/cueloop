---
"cueloop": patch
---

Make the branded transparent theme readable on a light terminal. The default `cueloop` theme leaves the background unpainted so the terminal shows through, but its text was tuned only for a dark terminal - on a white background it rendered light-on-light (notably for a collaborator opening a shared plan over SSH). cueloop now queries the terminal's background at startup (OpenTUI's OSC theme-mode query, ~200ms budget, falling back to dark) and picks a light transparent variant with dark text when the terminal is light. Applies to both the local TUI and the SSH-served observer view. The opaque palette presets (Catppuccin, Nord, …) are unchanged - they paint their own background and already read the same either way.
