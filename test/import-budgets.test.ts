/**
 * The import budget checker over fixtures: a layer reaching down and a module
 * over its budget both fail; the shapes the repo relies on pass.
 */

import { describe, expect, test } from "bun:test";
import {
  checkModule,
  packageOfFile,
  scanImportSpecifiers,
  type Budgets,
  type PackageHome,
} from "../scripts/check-import-budgets";

const PACKAGES: PackageHome[] = [
  { name: "@cueloop/schema", directory: "packages/schema" },
  { name: "@cueloop/daemon", directory: "packages/daemon" },
  { name: "@cueloop/integration-obsidian", directory: "packages/integrations/obsidian" },
];

const BUDGETS: Budgets = {
  layers: {
    "@cueloop/schema": [],
    "@cueloop/daemon": ["@cueloop/schema"],
    "@cueloop/integration-obsidian": ["@cueloop/schema"],
  },
  moduleImportBudget: 3,
  moduleBudgets: { "packages/daemon/src/wide.ts": 4 },
};

describe("scanImportSpecifiers", () => {
  test("finds static, type-only, bare, dynamic, and re-export specifiers once each, not in comments", () => {
    // Arrange
    const source = `
      import { a } from "@cueloop/schema";
      import type { B } from "@cueloop/schema";
      import "./side-effect";
      export { c } from './re-export';
      const d = await import("./lazy");
      // import { nope } from "./commented-out";
      /* import { nope } from "./block-comment"; */
    `;

    // Act
    const specifiers = scanImportSpecifiers(source);

    // Assert
    expect(specifiers).toEqual(["@cueloop/schema", "./side-effect", "./re-export", "./lazy"]);
  });
});

describe("packageOfFile", () => {
  test("picks the deepest package directory that holds the file", () => {
    // Assert
    expect(packageOfFile("packages/integrations/obsidian/src/index.ts", PACKAGES)?.name).toBe(
      "@cueloop/integration-obsidian",
    );
    expect(packageOfFile("packages/daemon/src/api.ts", PACKAGES)?.name).toBe("@cueloop/daemon");
    expect(packageOfFile("test/cli/session.test.ts", PACKAGES)).toBeNull();
  });
});

describe("checkModule", () => {
  test("a layer reaching down is a violation, naming the specifier", () => {
    // Act
    const violations = checkModule(
      "packages/schema/src/leak.ts",
      'import { DaemonCore } from "@cueloop/daemon/api";\n',
      BUDGETS,
      PACKAGES,
    );

    // Assert
    expect(violations.map((violation) => violation.message)).toEqual([
      '@cueloop/schema may not import @cueloop/daemon (via "@cueloop/daemon/api")',
    ]);
  });

  test("importing a package in the layer below, a subpath of it, and the package itself all pass", () => {
    // Act
    const violations = checkModule(
      "packages/daemon/src/ok.ts",
      'import { a } from "@cueloop/schema";\nimport { b } from "@cueloop/schema/history";\nimport { c } from "@cueloop/daemon/store";\n',
      BUDGETS,
      PACKAGES,
    );

    // Assert
    expect(violations).toEqual([]);
  });

  test("a module over its budget fails; a per-file budget and a test file are exempt from the default", () => {
    // Arrange
    const four = ["./a", "./b", "./c", "./d"].map((path) => `import "${path}";`).join("\n");

    // Assert
    expect(checkModule("packages/daemon/src/busy.ts", four, BUDGETS, PACKAGES)).toEqual([
      { file: "packages/daemon/src/busy.ts", message: "4 imports, budget 3" },
    ]);
    expect(checkModule("packages/daemon/src/wide.ts", four, BUDGETS, PACKAGES)).toEqual([]);
    expect(checkModule("packages/daemon/src/busy.test.ts", four, BUDGETS, PACKAGES)).toEqual([]);
  });

  test("a package without a layer is itself a violation", () => {
    // Act
    const violations = checkModule("packages/gateway/src/index.ts", "", BUDGETS, [
      ...PACKAGES,
      { name: "@cueloop/gateway", directory: "packages/gateway" },
    ]);

    // Assert
    expect(violations[0]!.message).toContain("has no layer");
  });
});
