/**
 * Import budgets: the dependency direction between packages and the number of
 * modules one file may import are checks, not habits. A package may import
 * only the workspace packages its layer sits above, and a module that imports
 * more than its budget of distinct specifiers is doing too much. Run as part
 * of `bun run lint`; the budgets live in import-budgets.json.
 */

import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import * as v from "valibot";

export const BudgetsSchema = v.object({
  /** Each workspace package and the workspace packages it may import. */
  layers: v.record(v.string(), v.array(v.string())),
  /** Distinct import specifiers a module may have unless it has its own budget. */
  moduleImportBudget: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** Per-file budgets, keyed by repo-relative path. */
  moduleBudgets: v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export type Budgets = v.InferOutput<typeof BudgetsSchema>;

export interface ImportViolation {
  file: string;
  message: string;
}

/** The workspace package a source file belongs to, by the directory that holds its package.json. */
export interface PackageHome {
  name: string;
  /** Repo-relative directory, `packages/daemon` or `packages/integrations/obsidian`. */
  directory: string;
}

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*["']([^"']+)["'])|(?:^\s*import\s*["']([^"']+)["'])|(?:\bimport\s*\(\s*["']([^"']+)["']\s*\))/gm;

/** Every module specifier a source imports, type imports included, comments ignored. */
export function scanImportSpecifiers(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const specifiers = new Set<string>();

  for (const match of withoutComments.matchAll(IMPORT_SPECIFIER)) {
    specifiers.add(match[1] ?? match[2] ?? match[3] ?? "");
  }
  specifiers.delete("");

  return [...specifiers];
}

/** The workspace package a specifier names, or null for anything else (`@cueloop/daemon/client` is `@cueloop/daemon`). */
export function workspacePackageOf(specifier: string, packages: string[]): string | null {
  return (
    packages.find(
      (candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`),
    ) ?? null
  );
}

/** The package a repo-relative file belongs to: the deepest package directory that contains it. */
export function packageOfFile(file: string, packages: PackageHome[]): PackageHome | null {
  let home: PackageHome | null = null;

  for (const candidate of packages) {
    if (!file.startsWith(`${candidate.directory}/`)) continue;
    if (home === null || candidate.directory.length > home.directory.length) home = candidate;
  }

  return home;
}

/**
 * The violations one source file carries: a reach into a package its layer
 * may not import, and a count of imports over its budget. Test files are held
 * to the layers but not to a budget.
 */
export function checkModule(
  file: string,
  source: string,
  budgets: Budgets,
  packages: PackageHome[],
): ImportViolation[] {
  const violations: ImportViolation[] = [];
  const specifiers = scanImportSpecifiers(source);
  const home = packageOfFile(file, packages);
  const workspaceNames = packages.map((candidate) => candidate.name);

  if (home !== null) {
    const allowed = budgets.layers[home.name];

    if (allowed === undefined) {
      violations.push({
        file,
        message: `package ${home.name} has no layer in import-budgets.json`,
      });
    } else {
      for (const specifier of specifiers) {
        const target = workspacePackageOf(specifier, workspaceNames);

        if (target !== null && target !== home.name && !allowed.includes(target)) {
          violations.push({
            file,
            message: `${home.name} may not import ${target} (via "${specifier}")`,
          });
        }
      }
    }
  }
  const isTest = /\.test\.tsx?$/.test(file);
  const budget = budgets.moduleBudgets[file] ?? budgets.moduleImportBudget;

  if (!isTest && specifiers.length > budget) {
    violations.push({
      file,
      message: `${specifiers.length} imports, budget ${budget}`,
    });
  }

  return violations;
}

const PackageManifestSchema = v.object({ name: v.string() });

async function workspacePackages(root: string): Promise<PackageHome[]> {
  const homes: PackageHome[] = [];

  for (const pattern of ["packages/*/package.json", "packages/integrations/*/package.json"]) {
    for await (const path of new Bun.Glob(pattern).scan(root)) {
      const manifest = v.parse(PackageManifestSchema, await Bun.file(`${root}/${path}`).json());

      homes.push({ name: manifest.name, directory: path.slice(0, -"/package.json".length) });
    }
  }

  return homes;
}

async function main(): Promise<number> {
  const root = process.cwd();
  const budgets = v.parse(BudgetsSchema, JSON.parse(readFileSync("import-budgets.json", "utf8")));
  const packages = await workspacePackages(root);
  const violations: ImportViolation[] = [];

  for await (const path of new Bun.Glob("packages/**/*.{ts,tsx}").scan(root)) {
    const file = relative(root, `${root}/${path}`).split(sep).join("/");

    if (file.includes("/node_modules/") || file.includes("/dist/")) continue;
    violations.push(
      ...checkModule(file, readFileSync(`${root}/${file}`, "utf8"), budgets, packages),
    );
  }
  for (const violation of violations) console.error(`${violation.file}: ${violation.message}`);
  if (violations.length) console.error(`${violations.length} import budget violation(s)`);

  return violations.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
