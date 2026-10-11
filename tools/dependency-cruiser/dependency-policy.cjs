const { globSync, readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const v = require("valibot");

const ManifestSchema = v.object({
  name: v.string(),
  workspaces: v.optional(v.array(v.string())),
  exports: v.optional(v.record(v.string(), v.string())),
  dependencies: v.optional(v.record(v.string(), v.string())),
  peerDependencies: v.optional(v.record(v.string(), v.string())),
  optionalDependencies: v.optional(v.record(v.string(), v.string())),
  devDependencies: v.optional(v.record(v.string(), v.string())),
});
const AccessExceptionSchema = v.object({
  from: v.string(),
  to: v.string(),
  reason: v.pipe(v.string(), v.minLength(1)),
});
const DEVELOPMENT_SOURCE =
  "^(test|benchmarks|snapshots|examples|scripts|tools)/|\\.(test|stories)\\.[cm]?[jt]sx?$|/(testing|stories|examples)/|^site/scripts/";
const TEST_SOURCE = "^test/|\\.(test|stories)\\.[cm]?[jt]sx?$|/(testing|stories)/";

function escapeDependencyPattern(path) {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dependencyPathPattern(paths) {
  return paths.map((path) => `^${escapeDependencyPattern(path)}$`).join("|");
}

function readDependencyManifest(path) {
  return v.parse(ManifestSchema, JSON.parse(readFileSync(path, "utf8")));
}

/** Workspace identities come from manifests, including nested integrations. */
function discoverDependencyPackages(root) {
  const manifest = readDependencyManifest(resolve(root, "package.json"));

  return (manifest.workspaces ?? []).flatMap((pattern) =>
    globSync(`${pattern}/package.json`, { cwd: root }).map((path) => {
      const directory = dirname(path).replaceAll("\\", "/");
      const workspace = readDependencyManifest(resolve(root, path));

      return {
        name: workspace.name,
        directory,
        dependencies: Object.keys({
          ...workspace.dependencies,
          ...workspace.peerDependencies,
          ...workspace.optionalDependencies,
        }),
        devDependencies: Object.keys(workspace.devDependencies ?? {}),
        entryPoints: Object.values(workspace.exports ?? {}).map(
          (entry) => `${directory}/${entry.replace(/^\.\//, "")}`,
        ),
      };
    }),
  );
}

/** Generate checks from the same package permissions and public exports used by the repo. */
function createDependencyConfiguration(root, site = false) {
  const packages = discoverDependencyPackages(root);
  const budgets = JSON.parse(readFileSync(resolve(root, "import-budgets.json"), "utf8"));
  const exceptions = v.parse(
    v.array(AccessExceptionSchema),
    JSON.parse(readFileSync(resolve(root, "dependency-access.json"), "utf8")),
  );
  const development = new RegExp(DEVELOPMENT_SOURCE);
  const accessPairs = new Set();

  for (const exception of exceptions) {
    if (!development.test(exception.from)) {
      throw new Error(
        `Dependency access: production source cannot have a private-access exception: ${exception.from}`,
      );
    }

    const pair = `${exception.from}\0${exception.to}`;

    if (accessPairs.has(pair))
      throw new Error(
        `Dependency access: duplicate exception: ${exception.from} -> ${exception.to}`,
      );

    accessPairs.add(pair);
  }
  const forbidden = [
    {
      name: "no-runtime-cycles",
      severity: "error",
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ["type-only", "type-import", "pre-compilation-only"] },
      },
    },
    {
      name: "type-dependency-cycles",
      severity: "warn",
      from: {},
      to: {
        circular: true,
        via: { dependencyTypes: ["type-only", "type-import", "pre-compilation-only"] },
      },
    },
    { name: "no-unresolved-imports", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-production-dev-dependencies",
      severity: "error",
      from: { pathNot: DEVELOPMENT_SOURCE },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-production-test-support",
      severity: "error",
      from: { pathNot: DEVELOPMENT_SOURCE },
      to: { path: TEST_SOURCE },
    },
    {
      name: "schema-has-no-runtime-dependencies",
      severity: "error",
      from: { path: "^packages/schema/", pathNot: DEVELOPMENT_SOURCE },
      to: { pathNot: "^packages/schema/" },
    },
  ];

  for (const home of packages) {
    const allowed = budgets.layers[home.name];

    if (!allowed) throw new Error(`Dependency policy: missing layer for ${home.name}`);

    const ownPath = `^${escapeDependencyPattern(home.directory)}/`;
    const undeclared = packages.filter(
      (target) => target.name !== home.name && !home.dependencies.includes(target.name),
    );

    for (const target of undeclared) {
      const from = { path: ownPath };

      if (home.devDependencies.includes(target.name)) from.pathNot = DEVELOPMENT_SOURCE;

      forbidden.push({
        name: `workspace-manifest-${home.name.replaceAll("@", "").replaceAll("/", "-")}-${target.name.replaceAll("@", "").replaceAll("/", "-")}`,
        severity: "error",
        from,
        to: { path: `^${escapeDependencyPattern(target.directory)}/` },
      });
    }

    const deniedHomes = packages.filter(
      (target) => target.name !== home.name && !allowed.includes(target.name),
    );

    if (deniedHomes.length) {
      forbidden.push({
        name: `package-layer-${home.name.replaceAll("@", "").replaceAll("/", "-")}`,
        severity: "error",
        from: { path: ownPath },
        to: { path: deniedHomes.map((target) => `^${escapeDependencyPattern(target.directory)}/`) },
      });
    }

    const access = exceptions.filter((exception) => exception.to.startsWith(`${home.directory}/`));
    const sources = [...new Set(access.map((exception) => exception.from))];

    forbidden.push({
      name: `public-interface-${home.name.replaceAll("@", "").replaceAll("/", "-")}`,
      severity: "error",
      from: { pathNot: [ownPath, ...sources.map((source) => dependencyPathPattern([source]))] },
      to: { path: ownPath, pathNot: dependencyPathPattern(home.entryPoints) || "(?!)" },
    });

    for (const source of sources) {
      forbidden.push({
        name: `testing-interface-${home.name.replaceAll("@", "").replaceAll("/", "-")}-${sources.indexOf(source)}`,
        severity: "error",
        from: { path: dependencyPathPattern([source]) },
        to: {
          path: ownPath,
          pathNot: dependencyPathPattern([
            ...home.entryPoints,
            ...access
              .filter((exception) => exception.from === source)
              .map((exception) => exception.to),
          ]),
        },
      });
    }
  }

  return {
    forbidden,
    options: {
      parser: "tsc",
      tsPreCompilationDeps: "specify",
      tsConfig: { fileName: resolve(root, site ? "site/tsconfig.json" : "tsconfig.json") },
      doNotFollow: { path: "(^|/)node_modules/" },
      exclude: { path: "(^|/)(dist|\\.astro|\\.git|\\.bench-tmp|\\.worktrees)/" },
      combinedDependencies: false,
      builtInModules: { add: ["bun", "bun:test", "bun:ffi", "bun:sqlite"] },
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["bun", "import", "default"],
        extensions: [
          ".ts",
          ".tsx",
          ".mts",
          ".cts",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
          ".json",
          ".d.ts",
        ],
      },
    },
  };
}

module.exports = {
  createDependencyConfiguration,
  discoverDependencyPackages,
  dependencyPathPattern,
  DEVELOPMENT_SOURCE,
};
