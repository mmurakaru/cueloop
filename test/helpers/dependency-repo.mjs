import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

/** Build a real workspace fixture for dependency parser and policy checks. */
export function createTestDependencyRepo() {
  const directory = mkdtempSync(resolve(tmpdir(), "cueloop-dependency-test-"));
  const write = (path, content) => {
    const target = resolve(directory, path);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const json = (path, value) => write(path, JSON.stringify(value));

  json("package.json", { name: "fixture", workspaces: ["packages/*", "packages/integrations/*"] });
  json("tsconfig.json", {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      verbatimModuleSyntax: true,
    },
    include: ["packages/**/*.ts", "test/**/*.ts"],
  });
  json("import-budgets.json", {
    layers: {
      "@fixture/base": [],
      "@fixture/consumer": ["@fixture/base"],
      "@fixture/integration": ["@fixture/base"],
    },
  });
  json("dependency-access.json", []);
  write("test/entry.ts", "export const fixture = true;\n");

  for (const [path, name, dependencies] of [
    ["packages/base", "@fixture/base", {}],
    ["packages/consumer", "@fixture/consumer", { "@fixture/base": "workspace:*" }],
    ["packages/integrations/sample", "@fixture/integration", { "@fixture/base": "workspace:*" }],
  ]) {
    json(`${path}/package.json`, {
      name,
      type: "module",
      exports: { ".": "./src/index.ts", "./client": "./src/client.ts" },
      dependencies,
    });
    write(
      `${path}/src/index.ts`,
      'export { value } from "./internal";\nexport type { Value } from "./internal";\n',
    );
    write(
      `${path}/src/internal.ts`,
      "export const value = 1;\nexport interface Value { value: number }\n",
    );
    write(`${path}/src/client.ts`, 'export { value } from "./internal";\n');

    const link = resolve(directory, "node_modules", name);

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(resolve(directory, path), link, "dir");
  }

  return {
    directory,
    write,
    json,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
