# Package interfaces

Each workspace is a module with an explicit public interface in its `package.json`
exports. Public entry points can live in different folders and expose multiple
subpaths. Everything else is implementation. Workspace discovery uses the root
workspace patterns, including `packages/integrations/*`.

Import another package through its declared entry points. An allowed package
dependency does not permit access to that package's private files. Same-package
implementation imports and colocated tests remain unrestricted by the public
interface check. Package permissions still apply to tests.

Keep entry points focused. Prefer small public subpaths over a barrel that exports
an entire implementation tree. Existing public exports are retained; adding more
exports just to make a test pass widens the interface unnecessarily.

Development tools sometimes need a private implementation, including PTY transport
tests and benchmarks that must avoid loading the full TUI. Each such import has an
exact source, target and reason in `dependency-access.json`. The check fails when
an exception becomes unused. Exceptions do not bypass package permissions or permit
production imports of test support.

Install the pinned analysis tools once, then run:

```sh
bun run deps:install
bun run lint:boundaries
bun run test:boundaries
bun run deps:report
bun run deps:report -- --focus 'packages/client/src/thread/thread-controller'
bun run deps:report -- --changed main
bun run deps:report -- --graphviz
```

`bun run lint` includes boundaries and retains the existing distinct-import
budgets. Reports are written to `dist/dependencies`. The `--graphviz` option requires
Graphviz's `dot` executable; validation, JSON, Mermaid and DOT generation do not.
CI installs Graphviz and uploads interactive reports. The affected view includes
changed modules and their reverse dependents; it never limits the validation graph.

Runtime cycles, undeclared dependencies, unresolved imports, private cross-package
access and production imports of test support fail validation. Type-only cycles
produce warnings. Separate runtime and type-inclusive overview diagrams prevent
type relationships from appearing as runtime coupling. Client reports group its
existing subsystems; Obsidian retains its own nested workspace identity.
`development.mmd` includes development consumers and their neighboring modules.
Each workspace also has a separate `*-runtime.mmd` view.

The standalone `site` uses its own dependencies and resolution context. After
`bun install --cwd site --frozen-lockfile`, run `bun run lint:site-boundaries`, or
`node tools/dependency-cruiser/dependency-analysis.mjs report --site` for reports.
This covers supported JS/TS files, not Astro/MDX imports or `?raw` asset loading.
The existing Astro checks and build still verify those framework concerns.

Static imports cannot represent computed extension/story imports, subprocess
entry-point paths, native FFI libraries or prepack file copying. Their existing
runtime tests remain necessary. A module absent from the import graph is not proof
that it is unused.

The analyzer's private tool environment pins dependency-cruiser and its supported
compiler. Application TypeScript stays on version 7. The compatibility fixtures
prove type declarations, type re-exports, inline type imports, Bun built-ins,
public subpaths and nested workspaces; no custom dependency parser is used.
