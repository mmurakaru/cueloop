# Dependency boundaries scan

Checked 2026-10-11 before implementation. This is the initial read-only investigation snapshot. The resulting commands and enforced policy are documented in [packages/README.md](../packages/README.md).

## Coverage

Every workspace package was inspected for manifests, exports, source imports, internal organization and test conventions. Counts below include tracked JS/TS modules and tests, not documentation, assets or native code. The standalone site was also inspected for its manifest, source imports, framework entry points and connection to repository tooling. This is dependency analysis, not a behavioral review of every function.

| Package | Tracked JS/TS modules | Boundary observations |
| --- | ---: | --- |
| schema | 40 | One public index; no external production dependencies; type-only cycle between types and history. |
| extension-api | 7 | Public index, client UI and installed-package entry points; React peers and schema dependency. |
| daemon | 81 | Twenty export keys; includes socket client and SDK alongside server implementation; runtime cycle between api and thread-review. |
| adapters | 49 | Nineteen export keys, including nested Codex, pi and fx interfaces; test reaches an unexported daemon implementation. |
| pi | 2 | Root extension plus Node prepack script; host peer dependency and adapters public entry point. |
| client | 326 | Three export keys whose targets span src subfolders; 117 tests and 62 stories; computed extension/story imports require separate coverage. |
| cli | 28 | Executable main is the sole export; its entry point runs the application, so public test helpers should not be added there casually. |
| gateway | 29 | Private workspace with one export and separate binary; twelve tests and a story; tests reach shared repository helpers. |
| integrations/obsidian | 9 | Nested workspace; one public index; schema and extension-api dependencies. |
| site | 39 | Separate private package and lockfile; Astro/MDX and TS6; imports repository benchmark code and raw data. |

Workspace identity must come from the root workspace patterns and package manifests, not an assumption that every package is an immediate child of packages. The site is a separate project and needs explicit graph coverage.

## Confirmed findings

- The current import checker passes, and its six fixture tests pass. It scans named specifiers, including literal dynamic imports and re-exports, but does not resolve relative imports or detect cycles. See [checker](../scripts/check-import-budgets.ts) and [tests](../test/import-budgets.test.ts).
- Runtime cycle: [api.ts](../packages/daemon/src/api.ts) imports resolveWorkspace from thread-review, and [thread-review.ts](../packages/daemon/src/thread-review.ts) imports messageResponse from api. This is proven by the direct import pair, not a dependency-cruiser run.
- Type-only cycle: [types.ts](../packages/schema/src/types.ts) imports SessionHistory from history, and [history.ts](../packages/schema/src/history.ts) imports Thread and related types from types.
- Cross-package private import: [adapters fx test](../packages/adapters/src/fx/harness.test.ts) imports daemon/src/thread-agent, which is not a daemon export. Many repository integration tests and benchmarks also import package source files directly. An import to an exported target file is distinct from an import to a private implementation; relative spelling is a separate policy decision.
- Client imports daemon public interfaces in production, permitted by [import-budgets.json](../import-budgets.json). The initial blanket statement in AGENTS.md that they never import each other did not match enforced policy. The canonical [map issue #1](https://github.com/mmurakaru/cueloop/issues/1) was subsequently retrieved; this integration preserves session mutation through the socket protocol and existing package ownership.
- Test-only code includes [store-conformance.ts](../packages/daemon/src/testing/store-conformance.ts), shared test/helpers, fake ACP process entry points, and client stories. A .test.ts suffix alone does not classify development code adequately.
- Computed imports in the client load installed extensions and stories. Static dependency graphs cannot certify these runtime-loaded edges. The story loader also loads gateway stories.
- [site bench-history](../site/src/bench-history.ts) and [bench-chart](../site/src/bench-chart.ts) depend on benchmarks/lib/history-record. Astro, MDX, raw-query imports and generated framework routes need explicit parser/coverage validation before claiming a complete site graph.
- Root TypeScript is 7.0.2 and does not expose the traditional createSourceFile/sys compiler APIs. Latest dependency-cruiser compatibility is documented in the [upstream research](./dependency-cruiser.md).

## Existing verification and rollout constraints

[CI](../.github/workflows/ci.yml) runs typecheck and lint separately on Bun 1.3.14. Local Bun is 1.4.2, Node is 24.18.1. No root umbrella check currently combines typecheck and lint. Lint runs oxlint plus import budgets; release/publish integrity checks are separate and should remain separate from static architecture checks.

Keep import-budgets.json as the authority for allowed package edges and distinct-specifier budgets. Manifest exports describe the existing public interfaces. A candidate integration should prove rejection of named and relative private imports, forbidden package edges, runtime cycles, unresolved real modules, undeclared package dependencies, and production imports of test support. Include passing cases for public subpaths, own-package internals, colocated tests, nested workspaces and Bun built-ins.

Proposed decisions for the interview: enforcement scope, public-interface policy, development-code exceptions, runtime versus type-only cycles, visualization audience and destination, and how much existing code to migrate initially. Parser compatibility is an engineering proof obligation rather than something the user should have to establish.
