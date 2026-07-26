# cueloop design system — provenance

Scraped 2026-07-26 via browser-harness (computed styles across each running app/site).
`tokens.css` is the canonical implementation; this file records where the values came from and the intent.

## Sources

### Hex (app.hex.tech) — the primary reference
The calm, technical notebook feel cueloop leans into.
- Canvas `#1f1f29`, panels `#1a1a23`, elevated `#353548` — blue-tinted near-blacks, not pure black.
- Text `#e4e6ec` primary, `#b1b6c4` muted, `#5f6b7c` dim.
- Signature salmon/coral accent `#f5c0c0`; code/data green `#62d96b` and teal-green `#43d59d`; link blue `#84a6e8`.
- Subtle tint fills (7–10% alpha) for highlights and hover, hairline borders.
- Radii dominated by **3px** — tight and precise, not friendly-rounded.
- Type: **IBM Plex Sans** + **IBM Plex Mono**.

### Cloudflare (cloudflare.com) — warm minimalism
- Warm near-black `#151414`, warm off-white text `#f0e3de`, orange `#ff5e1f`.
- Tight radii (3–6px), generous space, restraint.

### e2b (e2b.dev) — mono-forward brutalist-minimal + dotted canvas
- Pure black `#000` canvas, `#141414` panels, white text, orange `#ff8800`, coral `#ff7b72`.
- **IBM Plex Mono** heavy (shared DNA with Hex), mostly 0px radii, the dotted-grid motif.

## Distillation for cueloop
- One salmon accent of cueloop's own (`#f5a3a3` dark / `#d16670` light) — in the Hex family, not a copy.
- Near-black blue-tinted canvas (Hex) as the default dark base; clean warm-neutral light theme; **system** follows the OS.
- Green for insertions/approve/code, red for deletions/request-changes, blue for links/comment.
- Dotted-canvas motif available via `.dotted` (leaned on hardest by the Canvas concept).
- IBM Plex Sans/Mono with a robust system fallback so prototypes still render offline.
- Tight 3–4px radii; 8–12px only for cards and modals.

Verdict color mapping (consistent across concepts): Comment = blue, Approve = green, Request changes = red.
