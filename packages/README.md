# Package interfaces

Each workspace declares its public entry points in `package.json` exports.
Workspace discovery includes `packages/integrations/*`.

> [!IMPORTANT]
> Import other packages through their declared entry points.
> An allowed dependency does not grant access to private files.
> Tests follow the same package permissions.

Keep public subpaths focused.
Same-package implementation imports and colocated tests can use private files.
Development tools that need cross-package private imports must declare the exact source, target, and reason in `dependency-access.json`.
Unused exceptions fail validation.
Exceptions cannot permit production imports of test support.

## Check dependencies

```sh
bun run deps:install
bun run lint:boundaries
bun run test:boundaries
```

Validation rejects runtime cycles, undeclared dependencies, unresolved imports, private cross-package access, and production imports of test support.
Type-only cycles produce warnings.
`bun run lint` also checks import budgets.
The analysis tools use an isolated, pinned compiler; application TypeScript stays separate.

## Inspect reports

```sh
bun run deps:report
bun run deps:report -- --focus 'packages/client/src/thread/thread-controller'
bun run deps:report -- --changed main
bun run deps:report -- --graphviz
```

Reports go to `dist/dependencies`.
The changed view includes reverse dependents; validation always checks the full graph.
Runtime and type-inclusive diagrams are separate.
Each workspace has a runtime view, and `development.mmd` includes development consumers.

> [!NOTE]
> Only `--graphviz` requires Graphviz's `dot` executable.
> CI installs it and uploads interactive reports.

## Check the site

```sh
bun install --cwd site --frozen-lockfile
bun run lint:site-boundaries
node tools/dependency-cruiser/dependency-analysis.mjs report --site
```

The site uses its own dependency context.
Static analysis covers supported JavaScript and TypeScript files.
Astro checks and builds verify Astro, MDX, and raw asset imports.

Static reports do not prove that a module is unused.
Computed imports, subprocess paths, native libraries, and prepack copying still need runtime tests.
