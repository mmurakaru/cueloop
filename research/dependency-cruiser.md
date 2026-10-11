# dependency-cruiser research

Checked 2026-10-11 before implementation. This note records upstream research; implementation and verified commands are documented in [packages/README.md](../packages/README.md).

## Current release and compatibility

The npm registry's `latest` endpoint returned **18.5.0**. Its manifest declares Node `^22||^24||>=26` and supported TypeScript `>=2.0.0 <7.0.0`. GitHub marks v18.5.0, released September 30, as latest; it adds detection inside module/namespace blocks and stale-baseline reporting in Markdown. [npm registry](https://registry.npmjs.org/dependency-cruiser/latest), [release](https://github.com/sverweij/dependency-cruiser/releases/tag/v18.5.0)

Cueloop declares TypeScript `^7.0.2` in the root manifest. That is outside the advertised range. The v18.1.0 release says TypeScript 7.1.0 was expected to provide the first usable public compiler API. Treat that as an upstream expectation, not proof that an unpublished future combination works. [v18.1.0](https://github.com/sverweij/dependency-cruiser/releases/tag/v18.1.0)

The source checks installed compiler versions against supported ranges before declaring them available. A working Bun executable does not establish parser compatibility. [transpiler detection](https://github.com/sverweij/dependency-cruiser/blob/v18.5.0/src/extract/transpile/meta.mjs)

Upstream's FAQ requires compiler tooling alongside dependency-cruiser and recommends `--info` to inspect availability. It recognizes TypeScript configs when the host supports them, but documents Node execution. Static-string dynamic imports are discoverable; computed module names are not. [FAQ](https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md)

Recommendation: first validate an isolated Node-supported tool environment with a supported TypeScript compiler; compare Bun separately. Keep the project's compiler intact. SWC/Babel are alternative supported transpilers, but parity for type-only imports, TS7 syntax and resolution remains untested. Do not assume a TypeScript npm alias is recognized as `typescript`.

## Boundaries and validation

Rules operate on resolved paths, so package-boundary checks can cover relative paths and aliases. Group matching relates source and target folders. `circular`, `via` and `viaOnly` constrain cycles; folder scope also detects cycles absent at file level, but supports only a subset of conditions. Type-only dependency categories permit separate policies. The dependent-count rules measure incoming consumers, not outgoing import-specifier budgets. `couldNotResolve`, undeclared npm dependency categories, `orphan`, and `reachable` offer additional checks. [rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)

For cueloop, generate package-layer rules from `import-budgets.json`. Generate public-entry target paths from package manifests instead of assuming that every public interface is `src/index.ts`; support nested integrations and explicit subpath exports. A resolved-target allowlist alone permits relative imports to public entry files, so deciding whether to require package-name spelling is a separate policy.

Keep colocated tests able to import their own internals. Classify external integration tests, stories, benchmarks, scripts and hooks explicitly. Production-to-test edges are a useful error; orphan/reachability findings need real entry points, including hooks and adapter launch files, before enforcement.

`tsPreCompilationDeps: true` includes type dependencies; `"specify"` also distinguishes dependencies erased after compilation, with extra cost. Resolver options include export fields, conditions and main fields. `combinedDependencies: false` uses the nearest package manifest; `true` merges ancestor dependencies. Bun built-ins can be added through `builtInModules`. [options reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md)

Recommendations: count type-only imports for architectural boundaries; review their cycle severity separately. Keep nearest-manifest dependency validation to expose accidental reliance on root-installed packages. Test `bun`, `bun:test`, platform exports and workspace symlinks before enabling unresolved-import errors. Root tsconfig aliases can bypass export resolution, so validation should include a fixture demonstrating that a private target is rejected.

The standalone `site` package needs its own resolution context: Astro/MDX components and `?raw` imports are not proven covered by a TS/TSX cruise. Upstream's supported transpiler manifest lists TypeScript, Babel, SWC, Vue, Svelte and other language compilers, without an Astro/MDX compiler. Do not call a graph of its TypeScript files a complete site dependency graph. Decide whether to add site-specific extraction or record explicit coverage limitations. Include `bun:ffi` alongside `bun:test` in built-in resolution fixtures.

## Visualization, reports and rollout

`archi` summarizes architecture; `ddot` shows directories; `dot-webpage` generates interactive Graphviz HTML. Mermaid supports Markdown summaries; `html` is a dependency matrix, while `err-html` reports violations. JSON can be reformatted through `depcruise-fmt`; use its `--exit-code` with an error-capable reporter when gating saved JSON. `--affected` shows changed files and reverse dependents. `--baseline` and `--ignore-known` support existing violations, with shrink-only updates. Cache strategies are git metadata or content hashing. [CLI reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md)

Recommended views: package overview, one module graph per package, and a changed-module graph in CI. Use explicit aggregation for `packages/integrations/obsidian` to avoid collapsing all integrations into one node. Keep tests in analysis but hide them from production overview reports. Generate report artifacts instead of checking in timestamped graphs. Graphviz is an additional executable dependency; Mermaid summaries offer a simpler CI option.

The API exposes asynchronous `cruise` and reporting functions with semver guarantees. [API reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/api.md)

Recommendation: retain the existing distinct-specifier budget checker initially. Replacing its counts with graph edge counts changes semantics when specifiers resolve to the same target. A later migration must prove parity against per-file exceptions and test exemptions. Metrics such as instability are useful investigation signals, not substitutes for explicit layering.

Rollout proposal: compatibility fixture -> complete graph -> generated layer/public-interface rules -> inspect existing findings -> agree errors and baseline -> CI gate and reports. Keep CI validation complete; affected graphs explain changes but should not become the only architecture gate. Establish cold/warm timings before choosing caching. No runtime, parser, performance or baseline findings are claimed here.

## Implementation verification

The compatibility spike proved that a separate private tool environment with dependency-cruiser 18.5.0 and TypeScript 6.0.3 parses this repository correctly while application TypeScript stays at 7.0.2. SWC was rejected because its dependency-cruiser visitor missed inline type imports and type-only re-export classification. The fixture suite runs the supported compiler parser and verifies those cases.

Complete validation takes approximately five seconds in fresh local processes, with subsequent runs in the same range. No analysis cache is enabled: full checks are cheap enough to avoid cache invalidation complexity. Root and site graphs are validated separately; external dependencies remain visible leaves rather than being excluded. Existing type-only cycles warn; the daemon runtime cycle was removed without changing its public exports. No error baseline was needed.

Runtime validation and diagrams use an independent pass over the supported compiler's emitted JavaScript. This prevents shorter mixed cycles from hiding runtime rings in the type-inclusive graph. Workspace manifest declarations are checked against resolved paths, so TypeScript aliases and relative imports cannot bypass declaration checks. Both cases have regression fixtures.
