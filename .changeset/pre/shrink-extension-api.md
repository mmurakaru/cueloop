---
"cueloop": patch
---

Shrink the extension-api seam to what a second integration actually needs. Delete the zero-caller loader.ts (extension discovery, repo-trust store) and trim the contract to the exporter surface every consumer uses: Registry captures an extension's exporters and isolates a throwing factory; the renderer/command/keybinding/listener hooks that no extension registered are gone. Decouple the session controller from the concrete Obsidian integration: a new client integrations.ts composes the configured integrations into generic BundledExporter values (an Exporter plus its per-verdict run policy), so the controller depends only on the extension seam, never on an integration's own config type. Adding a second markdown-vault exporter is now a small addition to that composer rather than a change to the controller. No behavior change.
