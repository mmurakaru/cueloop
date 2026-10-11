# Dependency analysis tools

This private tooling project is outside the application's workspaces. Its pinned
TypeScript 6 compiler supplies the compiler APIs dependency-cruiser 18.5 needs;
the application's TypeScript 7 dependency and typecheck command are unchanged.

Install with `bun run deps:install` from the repository root. Commands and policy
are documented in [packages/README.md](../../packages/README.md).

`dependency-policy.cjs` derives public entry points from workspace manifests and
package permissions from `import-budgets.json`. `dependency-analysis.mjs` uses
dependency-cruiser's public analysis and reporting functions. Validation always
uses the complete supported graph. Report filtering and aggregation happen after
validation. Dependencies in node_modules are visible leaves, never traversed.

The fixture suite runs real parsing, module resolution and validation. Run
`bun run test:boundaries` after changing the tools, policy or pinned dependencies.
The root unit-test command remains responsible for application behavior.
