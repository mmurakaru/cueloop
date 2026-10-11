import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cruise, format } from "dependency-cruiser";
import ts from "typescript";
import policy from "./dependency-policy.cjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT_SOURCES = [
  "packages",
  "test",
  "hooks",
  "scripts",
  "benchmarks",
  "examples",
  "snapshots",
  "tools",
  ".dependency-cruiser.cjs",
];
const WORKSPACE_COLLAPSE = "^packages/(?:integrations/[^/]+|[^/]+)";

/** Analyze complete source sets; report filters never weaken validation. */
export async function analyzeDependencySources(sources, configuration, runtimeOnly = false) {
  const configPath = configuration.options.tsConfig.fileName;
  const sourceConfig = ts.readConfigFile(configPath, ts.sys.readFile);

  if (sourceConfig.error)
    throw new Error(ts.flattenDiagnosticMessageText(sourceConfig.error.messageText, "\n"));

  const parsed = ts.parseJsonConfigFileContent(sourceConfig.config, ts.sys, dirname(configPath));
  const result = await cruise(
    sources,
    {
      ...configuration.options,
      tsPreCompilationDeps: runtimeOnly ? false : "specify",
      ruleSet: configuration,
      validate: true,
      outputType: "json",
    },
    {},
    { tsConfig: parsed },
  );

  return JSON.parse(result.output);
}

/** Exceptions expire when the exact verification import disappears. */
export function unusedDependencyAccess(graph, exceptions) {
  const edges = new Set(
    graph.modules.flatMap((module) =>
      module.dependencies.map((dependency) => `${module.source}\0${dependency.resolved}`),
    ),
  );

  return exceptions.filter((exception) => !edges.has(`${exception.from}\0${exception.to}`));
}

async function writeDependencyReport(graph, destination, outputType, options = {}) {
  const { output } = await format(graph, { ...options, outputType });

  writeFileSync(destination, output);
}

async function writeDependencyViews(graph, runtime, directory, packages, graphviz) {
  const overview = {
    includeOnly: "^packages/",
    exclude: policy.DEVELOPMENT_SOURCE,
    collapse: WORKSPACE_COLLAPSE,
  };

  await writeDependencyReport(graph, resolve(directory, "architecture.mmd"), "mermaid", overview);
  await writeDependencyReport(runtime, resolve(directory, "runtime.mmd"), "mermaid", overview);
  await writeDependencyReport(graph, resolve(directory, "architecture.dot"), "dot", overview);
  await writeDependencyReport(graph, resolve(directory, "violations.html"), "err-html");
  await writeDependencyReport(graph, resolve(directory, "development.mmd"), "mermaid", {
    focus: policy.DEVELOPMENT_SOURCE,
    includeOnly: "^(packages|test|hooks|scripts|benchmarks|examples|snapshots|tools)/",
    collapse: `${WORKSPACE_COLLAPSE}|^(test|hooks|scripts|benchmarks|examples|snapshots|tools)/[^/]+`,
  });

  if (graphviz) {
    await writeDependencyReport(
      graph,
      resolve(directory, "architecture.html"),
      "dot-webpage",
      overview,
    );
    await writeDependencyReport(
      runtime,
      resolve(directory, "runtime.html"),
      "dot-webpage",
      overview,
    );
  }

  for (const home of packages) {
    const name = home.directory.replace(/^packages\//, "").replaceAll("/", "-");
    const view = { includeOnly: `^${home.directory}/`, exclude: policy.DEVELOPMENT_SOURCE };
    const grouped = { ...view };

    if (home.name === "@cueloop/client") grouped.collapse = "^packages/client/src/[^/]+";

    await writeDependencyReport(graph, resolve(directory, `${name}.dot`), "dot", view);
    await writeDependencyReport(graph, resolve(directory, `${name}.mmd`), "mermaid", grouped);
    await writeDependencyReport(
      runtime,
      resolve(directory, `${name}-runtime.mmd`),
      "mermaid",
      grouped,
    );

    if (graphviz) {
      await writeDependencyReport(
        graph,
        resolve(directory, `${name}.html`),
        "dot-webpage",
        grouped,
      );
    }
  }

  console.log(`Dependency reports: ${directory}`);
}

/** Changed modules and their reverse dependents form the impact report. */
export function changedDependencySources(reference) {
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${reference}...HEAD`],
    { encoding: "utf8" },
  );
  const working = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], {
    encoding: "utf8",
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });

  return [...new Set(`${changed}\n${working}\n${untracked}`.split("\n").filter(Boolean))];
}

async function runDependencyAnalysis() {
  const { values, positionals } = parseArgs({
    options: {
      site: { type: "boolean", default: false },
      graphviz: { type: "boolean", default: false },
      focus: { type: "string" },
      changed: { type: "string" },
      output: { type: "string", default: "dist/dependencies" },
    },
    allowPositionals: true,
  });
  const command = positionals[0] ?? "check";

  if (!["check", "report"].includes(command))
    throw new Error("Dependency analysis: use check or report");

  process.chdir(root);

  const directory = resolve(root, values.output);
  const configuration = policy.createDependencyConfiguration(root, values.site);
  const sources = values.site ? ["site"] : ROOT_SOURCES;
  const start = performance.now();
  const graph = await analyzeDependencySources(sources, configuration);
  const elapsed = performance.now() - start;

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, values.site ? "site.json" : "dependencies.json"),
    `${JSON.stringify(graph, null, 2)}\n`,
  );

  const stale = values.site
    ? []
    : unusedDependencyAccess(
        graph,
        JSON.parse(readFileSync(resolve(root, "dependency-access.json"), "utf8")),
      );

  for (const exception of stale) {
    console.error(`Dependency access exception is unused: ${exception.from} -> ${exception.to}`);
  }

  const { output } = await format(graph, { outputType: "err" });

  console.log(output);
  console.log(
    `Dependency analysis: ${graph.summary.totalCruised} modules, ${graph.summary.totalDependenciesCruised} edges, ${Math.round(elapsed)} ms`,
  );

  if (command === "report") {
    if (values.site) {
      await writeDependencyReport(graph, resolve(directory, "site.mmd"), "mermaid", {
        collapse: "^site/(?:src/[^/]+|functions|scripts)",
      });
      await writeDependencyReport(graph, resolve(directory, "site-violations.html"), "err-html");
    } else {
      const runtime = await analyzeDependencySources(sources, configuration, true);

      await writeDependencyViews(
        graph,
        runtime,
        directory,
        policy.discoverDependencyPackages(root),
        values.graphviz,
      );

      if (values.focus) {
        await writeDependencyReport(graph, resolve(directory, "focus.mmd"), "mermaid", {
          focus: values.focus,
          includeOnly: "^(packages|test|hooks|scripts|benchmarks|examples|snapshots|tools)/",
        });

        if (values.graphviz) {
          await writeDependencyReport(graph, resolve(directory, "focus.html"), "dot-webpage", {
            focus: values.focus,
            includeOnly: "^(packages|test|hooks|scripts|benchmarks|examples|snapshots|tools)/",
          });
        }
      }

      if (values.changed) {
        const changed = changedDependencySources(values.changed);

        if (changed.length) {
          await writeDependencyReport(graph, resolve(directory, "affected.mmd"), "mermaid", {
            reaches: policy.dependencyPathPattern(changed),
            includeOnly: "^(packages|test|hooks|scripts|benchmarks|examples|snapshots|tools)/",
          });
        }
      }
    }
  }

  process.exitCode = graph.summary.error > 0 || stale.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runDependencyAnalysis();
}
