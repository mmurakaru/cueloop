# cueloop app-shell prototype

Throwaway browser prototype of the four-pane workbench (Threads · Thread · Changes · Project).
Not production. Open `app-shell.html` in a browser (`open prototypes/app-shell.html`).

- `app-shell.html` — self-contained: React + ReactDOM inlined, app pre-compiled, no in-browser
  Babel. Renders instantly offline (Tailwind is the only CDN, for styling only).
- `app-shell.src.jsx` — the editable JSX source. After editing, rebuild the html:

```sh
bun build prototypes/app-shell.src.jsx --format=iife > /tmp/app.js
# then splice /tmp/app.js as the last <script> in app-shell.html (React/ReactDOM/style unchanged)
```

Panel state deep-links: `?threads=1&changes=1&project=1&mode=tree&zoom=1`.

Split model + naming follow VSCode's editor grid: a grid of GridNodes (leaf = editor group with
tabs, branch along an Orientation); Split creates a new group in a Direction (Up/Down => vertical,
Left/Right => horizontal), even Sizing.Distribute; the focused group is the active group.
