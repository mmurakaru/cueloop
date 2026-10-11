import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTestDependencyRepo } from "../../test/helpers/dependency-repo.mjs";
import { analyzeDependencySources, unusedDependencyAccess } from "./dependency-analysis.mjs";
import policy from "./dependency-policy.cjs";

async function withDependencyFixture(run) {
  const fixture = createTestDependencyRepo();
  const previous = process.cwd();

  try {
    process.chdir(fixture.directory);

    return await run(fixture, () =>
      analyzeDependencySources(
        ["packages", "test"],
        policy.createDependencyConfiguration(fixture.directory),
      ),
    );
  } finally {
    process.chdir(previous);
    fixture.close();
  }
}

function dependencyRuleNames(graph) {
  return graph.summary.violations.map((violation) => violation.rule.name);
}

describe("dependency parser and public interfaces", () => {
  test("public subpaths, nested workspaces, own internals and Bun built-ins pass", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.write(
        "packages/consumer/src/index.ts",
        'import { value } from "@fixture/base/client";\nexport { value };\n',
      );
      fixture.write(
        "packages/integrations/sample/src/index.ts",
        'export { value } from "@fixture/base";\n',
      );
      fixture.write(
        "packages/base/src/internal.test.ts",
        'import { value } from "./internal";\nimport { test } from "bun:test";\ntest("value", () => value);\n',
      );
      fixture.write("test/entry.ts", 'export { value } from "../packages/base/src/client";\n');

      expect((await analyze()).summary.error).toBe(0);
    }));

  test("relative private imports and forbidden package directions fail", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.write(
        "packages/consumer/src/index.ts",
        'export { value } from "../../base/src/internal";\n',
      );
      fixture.write("packages/base/src/index.ts", 'export { value } from "@fixture/consumer";\n');

      const names = dependencyRuleNames(await analyze());

      expect(names).toContain("public-interface-fixture-base");
      expect(names).toContain("package-layer-fixture-base");
    }));

  test("type-only declarations, re-exports and inline type imports remain in the graph", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.write(
        "packages/consumer/src/index.ts",
        'import type { Value } from "@fixture/base";\nexport type { Value as ClientValue } from "@fixture/base/client";\nexport type InlineValue = import("@fixture/base").Value;\nexport type Result = Value;\n',
      );
      fixture.write("packages/base/src/client.ts", 'export type { Value } from "./internal";\n');

      const graph = await analyze();
      const imports = graph.modules.find(
        (module) => module.source === "packages/consumer/src/index.ts",
      ).dependencies;

      expect(imports.filter((dependency) => dependency.preCompilationOnly)).toHaveLength(3);
      expect(graph.summary.error).toBe(0);
    }));

  test("runtime cycles fail while type-only cycles warn", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.write(
        "packages/base/src/a.ts",
        'import type { B } from "./b";\nexport interface A { b: B }\n',
      );
      fixture.write(
        "packages/base/src/b.ts",
        'import type { A } from "./a";\nexport interface B { a: A }\n',
      );

      const types = await analyze();

      expect(types.summary.error).toBe(0);
      expect(dependencyRuleNames(types)).toContain("type-dependency-cycles");

      fixture.write(
        "packages/base/src/a.ts",
        'import { b } from "./b";\nexport function a() { return b(); }\n',
      );
      fixture.write(
        "packages/base/src/b.ts",
        'import { a } from "./a";\nexport function b() { return a(); }\n',
      );

      expect(dependencyRuleNames(await analyze())).toContain("no-runtime-cycles");
    }));

  test("path aliases cannot bypass a private interface", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.json("tsconfig.json", {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          verbatimModuleSyntax: true,
          paths: { "private-alias": ["./packages/base/src/internal.ts"] },
        },
      });
      fixture.write("packages/consumer/src/index.ts", 'export { value } from "private-alias";\n');

      expect(dependencyRuleNames(await analyze())).toContain("public-interface-fixture-base");
    }));

  test("production sources cannot claim verification exceptions", () =>
    withDependencyFixture(async (fixture) => {
      fixture.json("dependency-access.json", [
        {
          from: "packages/consumer/src/index.ts",
          to: "packages/base/src/internal.ts",
          reason: "Invalid production access.",
        },
      ]);

      expect(() => policy.createDependencyConfiguration(fixture.directory)).toThrow(
        "production source cannot have a private-access exception",
      );
    }));

  test("production test support, unresolved and undeclared npm imports fail", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.write("packages/base/src/testing/support.ts", "export const support = 1;\n");
      fixture.json("node_modules/unlisted/package.json", { name: "unlisted", main: "index.js" });
      fixture.write("node_modules/unlisted/index.js", "exports.value = 1;\n");
      fixture.write(
        "packages/base/src/index.ts",
        'export { support } from "./testing/support";\nimport "./missing";\nimport "unlisted";\n',
      );

      const names = dependencyRuleNames(await analyze());

      expect(names).toContain("no-production-test-support");
      expect(names).toContain("no-unresolved-imports");
      expect(names).toContain("no-undeclared-dependencies");
    }));

  test("private-access exceptions allow only the exact pair and expose stale access", () =>
    withDependencyFixture(async (fixture, analyze) => {
      fixture.write("test/entry.ts", 'export { value } from "../packages/base/src/internal";\n');
      const exception = {
        from: "test/entry.ts",
        to: "packages/base/src/internal.ts",
        reason: "Exercise an internal verification contract.",
      };

      fixture.json("dependency-access.json", [exception]);

      const allowed = await analyze();

      expect(allowed.summary.error).toBe(0);
      expect(unusedDependencyAccess(allowed, [exception])).toHaveLength(0);

      fixture.write("test/other.ts", 'export { value } from "../packages/base/src/internal";\n');

      expect(dependencyRuleNames(await analyze())).toContain("public-interface-fixture-base");

      fixture.write("test/entry.ts", "export const value = 1;\n");

      expect(unusedDependencyAccess(await analyze(), [exception])).toEqual([exception]);
    }));

  test("the isolated parser leaves the application's compiler on TypeScript 7", () => {
    const app = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const tooling = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

    expect(Number(app.devDependencies.typescript.match(/\d+/)[0])).toBeGreaterThanOrEqual(7);
    expect(tooling.dependencies.typescript).toBe("6.0.3");
  });
});
